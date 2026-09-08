/**
 * ============================================================================
 * MÓDULO DE PAGO A PROVEEDORES -- registrarPagoProveedor()
 * ============================================================================
 * Cubre, en una sola función y una sola transacción, los 11 puntos de la
 * especificación de Eduardo (7 sept 2026):
 *
 *   1-4) Fecha, proveedor, RUC/Cédula (ya en la ficha del proveedor) y forma
 *        de pago (Caja General / Transferencia / Cheque).
 *   5)   Numeración automática "YY-X-NN" por mes (Caja General/Transferencia)
 *        o el número de cheque tal cual (Cheque) -- ver `comprobante-utils.ts`.
 *   6)   Número de factura a pagar.
 *   7)   Retención automática 2%/10% con exoneración por constancia de no
 *        retención vigente -- ver `retencion.ts`.
 *   8)   Concepto del pago.
 *   9)   Cuentas de gasto (multi-línea) -- deben sumar el monto de la factura.
 *   10)  Historial de cuentas usadas por el proveedor -- ver
 *        `historial-proveedor.ts` (consulta aparte, no la hace esta función).
 *   11)  Jornalización automática: unifica los puntos 6 y 9 en el concepto
 *        del asiento y traslada Débito/Crédito automáticamente.
 *
 * Partida doble resultante (siempre cuadra por construcción):
 *   Débito  cuenta(s) de gasto ......... = montoFactura
 *   Crédito Retenciones Por Pagar ...... = montoRetencion (si aplica)
 *   Crédito Caja/Banco (cuentaOrigen) .. = montoFactura - montoRetencion
 */
import type { PrismaClient, FormaPagoProveedor, LibroContable } from "@prisma/client";
import { obtenerCuenta, siguienteNumeroAsientoMensual } from "../caja/comprobante-utils";
import { crearComprobanteBalanceado, agruparPorCuenta } from "../caja/procesar-pago";
import { calcularRetencion, proveedorEstaExonerado, type TipoGastoRetencion } from "./retencion";

const CUENTA_CAJA_GENERAL = "110101";
/// Cuentas DETALLE reales del catálogo (210602 "Retenciones DGI" es un
/// agrupador MAYOR -- NO se le puede imputar directamente, ver
/// `obtenerCuenta()`). Cada tipo de gasto tiene su propia sub-cuenta DGI:
const CUENTA_RETENCION_COMPRA_O_SERVICIO_GENERAL = "21060202"; // "IR Compra De Bienes Y Servicios" (2%)
const CUENTA_RETENCION_SERVICIO_PROFESIONAL = "21060203"; // "IR Servicios Profesionales" (10%)

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface DetalleGastoPago {
  /** Código de la cuenta de gasto en el catálogo (libro COLEGIO), ej. "60208" (Servicios Básicos). */
  cuentaGastoCodigo: string;
  monto: number;
  descripcion?: string;
}

export interface ParametrosPagoProveedor {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  proveedorId: number;
  fechaPago: Date;
  formaPago: FormaPagoProveedor;
  /** Código de la cuenta de la que sale el dinero. Por defecto "110101" (Caja General) si formaPago=CAJA_GENERAL; OBLIGATORIO para TRANSFERENCIA/CHEQUE (hay que decir de qué banco sale). */
  cuentaOrigenCodigo?: string;
  /** Obligatorio si formaPago==="CHEQUE" -- se usa tal cual como número de comprobante. */
  numeroCheque?: string;
  numeroFactura?: string;
  conceptoPago: string;
  tipoGasto: TipoGastoRetencion;
  /** Monto total de la factura (con IVA incluido, si aplica). */
  montoFactura: number;
  /** Solo relevante para COMPRA_O_SERVICIO_GENERAL: monto antes de IVA. Si se omite, se usa `montoFactura` completo. */
  baseImponibleSinIva?: number;
  /** Multi-línea de cuentas de gasto -- debe sumar exactamente `montoFactura`. */
  detalleGastos: DetalleGastoPago[];
  /** Código de la cuenta de pasivo de retención. Por defecto "21060202" (2%) o "21060203" (10%) según `tipoGasto`. */
  cuentaRetencionCodigo?: string;
  creadoPor?: string;
}

export interface ResultadoPagoProveedor {
  pagoId: bigint;
  comprobanteId: bigint;
  claveComprobante: string;
  montoFactura: number;
  porcentajeRetencion: number;
  montoRetencion: number;
  montoNetoPagado: number;
  motivoRetencion: string;
}

export async function registrarPagoProveedor(
  prisma: PrismaClient,
  params: ParametrosPagoProveedor
): Promise<ResultadoPagoProveedor> {
  if (params.detalleGastos.length === 0) {
    throw new Error("El pago no tiene ninguna cuenta de gasto -- agrega al menos una línea en 'Cuentas de gastos a utilizar'.");
  }
  const sumaDetalle = redondear(params.detalleGastos.reduce((s, d) => s + d.monto, 0));
  const diferenciaFactura = redondear(sumaDetalle - params.montoFactura);
  if (Math.abs(diferenciaFactura) > 0.01) {
    throw new Error(
      `Las cuentas de gasto suman C$${sumaDetalle.toFixed(2)} pero la factura es de C$${params.montoFactura.toFixed(2)} (diferencia C$${diferenciaFactura.toFixed(2)}). No se guarda nada -- corrige el detalle de gastos.`
    );
  }
  if (params.formaPago === "CHEQUE" && !params.numeroCheque) {
    throw new Error('Falta el número de cheque -- es obligatorio cuando la forma de pago es "Cheque".');
  }
  if (params.formaPago !== "CAJA_GENERAL" && !params.cuentaOrigenCodigo) {
    throw new Error(
      `Falta indicar de qué cuenta bancaria sale el pago (cuentaOrigenCodigo) -- obligatorio para ${params.formaPago}.`
    );
  }

  const libro = params.libro ?? "COLEGIO";

  return prisma.$transaction(async (tx) => {
    const proveedor = await tx.terceroBeneficiario.findUnique({ where: { id: params.proveedorId } });
    if (!proveedor) throw new Error(`No existe el proveedor #${params.proveedorId}.`);

    const exonerado = proveedorEstaExonerado(proveedor, params.fechaPago);
    const retencion = calcularRetencion({
      tipoGasto: params.tipoGasto,
      montoFactura: params.montoFactura,
      baseImponibleSinIva: params.baseImponibleSinIva,
      proveedorExonerado: exonerado,
    });
    const montoNeto = redondear(params.montoFactura - retencion.monto);

    const cuentaOrigen = await obtenerCuenta(tx, libro, params.cuentaOrigenCodigo ?? CUENTA_CAJA_GENERAL);
    const cuentaRetencionDefecto =
      params.tipoGasto === "SERVICIO_PROFESIONAL" ? CUENTA_RETENCION_SERVICIO_PROFESIONAL : CUENTA_RETENCION_COMPRA_O_SERVICIO_GENERAL;
    const cuentaRetencion =
      retencion.monto > 0 ? await obtenerCuenta(tx, libro, params.cuentaRetencionCodigo ?? cuentaRetencionDefecto) : null;

    // --- Resuelve cada línea de gasto y arma el débito ---
    const lineasGasto: { cuentaId: number; monto: number; nombre: string; codigo: string }[] = [];
    for (const d of params.detalleGastos) {
      const cuenta = await obtenerCuenta(tx, libro, d.cuentaGastoCodigo);
      lineasGasto.push({ cuentaId: cuenta.id, monto: d.monto, nombre: cuenta.nombre, codigo: cuenta.codigo });
    }

    // --- Numeración (punto 5) ---
    const anio = params.fechaPago.getUTCFullYear();
    const mes = params.fechaPago.getUTCMonth() + 1;
    let tipoComprobante: "CD" | "CK";
    let claveComprobanteOverride: string;
    if (params.formaPago === "CHEQUE") {
      tipoComprobante = "CK";
      claveComprobanteOverride = params.numeroCheque!;
    } else {
      tipoComprobante = "CD";
      claveComprobanteOverride = await siguienteNumeroAsientoMensual(tx, { colegioId: params.colegioId, libro, anio, mes });
    }

    // --- Concepto unificado (punto 11: junta el # de factura y las cuentas de gasto) ---
    const detalleCuentasTexto = lineasGasto.map((l) => `${l.codigo} ${l.nombre} (C$${l.monto.toFixed(2)})`).join("; ");
    const concepto = `${params.conceptoPago}${params.numeroFactura ? ` -- Fact. ${params.numeroFactura}` : ""} -- ${detalleCuentasTexto}`;

    const debitos = lineasGasto.map((l) => ({ cuentaId: l.cuentaId, monto: l.monto }));
    const creditos = agruparPorCuenta([
      { cuentaId: cuentaOrigen.id, monto: montoNeto },
      ...(cuentaRetencion ? [{ cuentaId: cuentaRetencion.id, monto: retencion.monto }] : []),
    ]);

    const comprobante = await crearComprobanteBalanceado(tx, {
      colegioId: params.colegioId,
      libro,
      tipoComprobante,
      origen: "AUTO_PAGO_PROVEEDOR",
      fecha: params.fechaPago,
      concepto,
      debitos,
      creditos,
      beneficiarioId: params.proveedorId,
      noDocumento: params.numeroFactura,
      noCheque: params.formaPago === "CHEQUE" ? params.numeroCheque : undefined,
      claveComprobanteOverride,
    });

    const pago = await tx.pagoProveedor.create({
      data: {
        colegioId: params.colegioId,
        libro,
        proveedorId: params.proveedorId,
        fechaPago: params.fechaPago,
        formaPago: params.formaPago,
        cuentaOrigenId: cuentaOrigen.id,
        numeroComprobantePago: claveComprobanteOverride,
        numeroFactura: params.numeroFactura,
        conceptoPago: params.conceptoPago,
        tipoGasto: params.tipoGasto,
        montoFactura: params.montoFactura,
        baseImponibleSinIva: params.baseImponibleSinIva,
        exoneradoPorConstancia: exonerado,
        porcentajeRetencionAplicado: retencion.porcentaje,
        montoRetencion: retencion.monto,
        cuentaRetencionId: cuentaRetencion?.id,
        montoNetoPagado: montoNeto,
        comprobanteId: comprobante.comprobanteId,
        creadoPor: params.creadoPor,
        detalle: {
          create: params.detalleGastos.map((d, i) => ({
            cuentaGastoId: lineasGasto[i].cuentaId,
            monto: d.monto,
            descripcion: d.descripcion,
          })),
        },
      },
    });

    return {
      pagoId: pago.id,
      comprobanteId: comprobante.comprobanteId,
      claveComprobante: comprobante.claveComprobante,
      montoFactura: params.montoFactura,
      porcentajeRetencion: retencion.porcentaje,
      montoRetencion: retencion.monto,
      montoNetoPagado: montoNeto,
      motivoRetencion: retencion.motivo,
    };
  });
}
