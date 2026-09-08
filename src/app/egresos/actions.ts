"use server";

/** Server Actions de la Pantalla de Egresos y Proveedores. */
import { prisma } from "../../lib/prisma";
import { registrarPagoProveedor, type ParametrosPagoProveedor, type ResultadoPagoProveedor } from "../../lib/pagos/registrar-pago-proveedor";
import { obtenerHistorialProveedor, type PagoHistoricoProveedor, type CuentaFrecuenteProveedor } from "../../lib/pagos/historial-proveedor";
import { calcularRetencion, proveedorEstaExonerado, type TipoGastoRetencion } from "../../lib/pagos/retencion";

export interface OpcionProveedor {
  id: number;
  nombreCompleto: string;
  nombreComercial: string | null;
  rucCedula: string | null;
  tieneConstanciaNoRetencion: boolean;
}

export async function buscarProveedoresAction(colegioId: number, texto: string): Promise<OpcionProveedor[]> {
  const filtroTexto = texto.trim();
  const proveedores = await prisma.terceroBeneficiario.findMany({
    where: {
      OR: [{ colegioId }, { colegioId: null }],
      ...(filtroTexto
        ? {
            OR: [
              { nombreCompleto: { contains: filtroTexto, mode: "insensitive" } },
              { nombreComercial: { contains: filtroTexto, mode: "insensitive" } },
              { rucCedula: { contains: filtroTexto, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { nombreCompleto: "asc" },
    take: 30,
  });
  return proveedores.map((p) => ({
    id: p.id,
    nombreCompleto: p.nombreCompleto,
    nombreComercial: p.nombreComercial,
    rucCedula: p.rucCedula,
    tieneConstanciaNoRetencion: p.tieneConstanciaNoRetencion,
  }));
}

export interface HistorialProveedorResultado {
  pagos: (Omit<PagoHistoricoProveedor, "pagoId" | "fechaPago"> & { pagoId: string; fechaPago: string })[];
  cuentasFrecuentes: (Omit<CuentaFrecuenteProveedor, "ultimaVezUsada"> & { ultimaVezUsada: string })[];
  exonerado: boolean;
}

export async function obtenerHistorialProveedorAction(proveedorId: number, fechaPago: string): Promise<HistorialProveedorResultado> {
  const proveedor = await prisma.terceroBeneficiario.findUniqueOrThrow({ where: { id: proveedorId } });
  const { pagos, cuentasFrecuentes } = await obtenerHistorialProveedor(prisma, proveedorId, { limite: 10 });
  return {
    pagos: pagos.map((p) => ({ ...p, pagoId: p.pagoId.toString(), fechaPago: p.fechaPago.toISOString() })),
    cuentasFrecuentes: cuentasFrecuentes.map((c) => ({ ...c, ultimaVezUsada: c.ultimaVezUsada.toISOString() })),
    exonerado: proveedorEstaExonerado(proveedor, new Date(fechaPago)),
  };
}

export interface VistaPreviaRetencionEntrada {
  proveedorId: number;
  tipoGasto: TipoGastoRetencion;
  montoFactura: number;
  baseImponibleSinIva?: number;
  fechaPago: string;
}

export interface VistaPreviaRetencion {
  porcentaje: number;
  base: number;
  monto: number;
  motivo: string;
  montoNetoAPagar: number;
}

/** Recalcula la retención EN VIVO (mismas reglas que el registro real) para que la pantalla muestre el neto antes de guardar nada. */
export async function calcularVistaPreviaRetencionAction(entrada: VistaPreviaRetencionEntrada): Promise<VistaPreviaRetencion> {
  const proveedor = await prisma.terceroBeneficiario.findUniqueOrThrow({ where: { id: entrada.proveedorId } });
  const exonerado = proveedorEstaExonerado(proveedor, new Date(entrada.fechaPago));
  const retencion = calcularRetencion({
    tipoGasto: entrada.tipoGasto,
    montoFactura: entrada.montoFactura,
    baseImponibleSinIva: entrada.baseImponibleSinIva,
    proveedorExonerado: exonerado,
  });
  return { ...retencion, montoNetoAPagar: Math.round((entrada.montoFactura - retencion.monto + Number.EPSILON) * 100) / 100 };
}

export interface OpcionCuentaGasto {
  codigo: string;
  nombre: string;
}

export async function listarCuentasDeGastoAction(): Promise<OpcionCuentaGasto[]> {
  const cuentas = await prisma.catalogoCuenta.findMany({
    where: { libro: "COLEGIO", tipoCuenta: "DETALLE", clase: { in: ["GASTO", "COSTO"] }, activo: true },
    orderBy: { codigo: "asc" },
  });
  return cuentas.map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
}

export interface OpcionCuentaOrigen {
  codigo: string;
  nombre: string;
}

export async function listarCuentasDeOrigenAction(): Promise<OpcionCuentaOrigen[]> {
  // Caja/Bancos: cuentas DETALLE de Activo cuyo código empieza en "1101" (Caja/Bancos) según el catálogo real.
  const cuentas = await prisma.catalogoCuenta.findMany({
    where: { libro: "COLEGIO", tipoCuenta: "DETALLE", clase: "ACTIVO", codigo: { startsWith: "1101" }, activo: true },
    orderBy: { codigo: "asc" },
  });
  return cuentas.map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
}

export interface RegistrarPagoEntrada {
  colegioId: number;
  proveedorId: number;
  fechaPago: string;
  formaPago: "CAJA_GENERAL" | "TRANSFERENCIA" | "CHEQUE";
  cuentaOrigenCodigo?: string;
  numeroCheque?: string;
  numeroFactura?: string;
  conceptoPago: string;
  tipoGasto: TipoGastoRetencion;
  montoFactura: number;
  baseImponibleSinIva?: number;
  detalleGastos: { cuentaGastoCodigo: string; monto: number; descripcion?: string }[];
  creadoPor?: string;
}

export interface RegistrarPagoResultado {
  ok: boolean;
  mensaje?: string;
  resultado?: Omit<ResultadoPagoProveedor, "pagoId" | "comprobanteId"> & { pagoId: string; comprobanteId: string };
}

export async function registrarPagoAction(entrada: RegistrarPagoEntrada): Promise<RegistrarPagoResultado> {
  try {
    const params: ParametrosPagoProveedor = {
      colegioId: entrada.colegioId,
      proveedorId: entrada.proveedorId,
      fechaPago: new Date(entrada.fechaPago),
      formaPago: entrada.formaPago,
      cuentaOrigenCodigo: entrada.cuentaOrigenCodigo,
      numeroCheque: entrada.numeroCheque,
      numeroFactura: entrada.numeroFactura,
      conceptoPago: entrada.conceptoPago,
      tipoGasto: entrada.tipoGasto,
      montoFactura: entrada.montoFactura,
      baseImponibleSinIva: entrada.baseImponibleSinIva,
      detalleGastos: entrada.detalleGastos,
      creadoPor: entrada.creadoPor,
    };
    const resultado = await registrarPagoProveedor(prisma, params);
    return {
      ok: true,
      resultado: { ...resultado, pagoId: resultado.pagoId.toString(), comprobanteId: resultado.comprobanteId.toString() },
    };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado registrando el pago." };
  }
}
