/**
 * ============================================================================
 * MOTOR DE LA PANTALLA DE CAJERA -- procesarPago()
 * ============================================================================
 * Esta es la función que la interfaz de caja llama cada vez que la cajera
 * cobra algo. Recibe un "objeto de pago" (lo que la cajera seleccionó en
 * pantalla: el alumno, el arancel, la forma de pago) y hace TODO el trabajo
 * contable que hoy se hace a mano:
 *
 *   1) Decide, para cada línea del cobro, contra qué cuenta contable se
 *      abona (Caja General, Ingresos Recibidos por Anticipado, Otros
 *      Ingresos, o el libro del Programa ICCM).
 *   2) Arma el/los asientos de partida doble (Débito = Crédito, SIEMPRE).
 *   3) Guarda el Recibo Oficial de Caja (ROC), el detalle del recibo, el
 *      comprobante y sus líneas -- todo en UNA sola transacción de base de
 *      datos: o se guarda TODO, o no se guarda NADA (así nunca puede quedar
 *      un ROC sin su asiento, o un asiento descuadrado a medias).
 *   4) Actualiza el saldo pendiente del/los cargo(s) que se pagaron.
 *
 * Antes de guardar cualquier cosa, se revisa que la suma de débitos sea
 * igual a la suma de créditos de CADA comprobante que se vaya a crear. Si
 * alguna vez no cuadrara (no debería pasar nunca, dado cómo está armada la
 * función, pero se revisa igual como red de seguridad), se lanza un error y
 * la transacción completa se revierte -- así es IMPOSIBLE que quede un
 * asiento "Descuadrado" grabado en el Libro Diario.
 */
import type { PrismaClient, LibroContable, FormaPago } from "@prisma/client";
import { evaluarMora } from "../facturacion/reglas";
import { obtenerReglaMoraVigente } from "../facturacion/regla-mora-vigente";
import { construirMapaDeConceptosPorModalidad } from "../facturacion/mapa-conceptos";
import { obtenerModalidadVigente } from "../facturacion/historial-modalidad";
import { crearOActualizarCargo } from "../facturacion/generar-cargos";
import { siguienteNumeroComprobante, siguienteNumeroRoc, obtenerCuenta, type Tx } from "./comprobante-utils";

// ----------------------------------------------------------------------------
// Cuentas fijas del "amarre automático" (punto 5 de la especificación)
// ----------------------------------------------------------------------------
const CUENTA_CAJA_GENERAL = "110101"; // libro COLEGIO
const CUENTA_ANTICIPOS = "2110"; // libro COLEGIO -- "Ingresos Recibidos por Anticipado"
const CUENTA_BANCO_USD_ICCM = "11010401"; // libro ICCM -- "Banco USD - Cta. Corriente"
const CUENTA_COMISIONES_BANCARIAS_ICCM = "620601"; // libro ICCM -- "Comisiones Bancarias"
const CUENTA_ICCM_INGRESO_MENSUALIDAD = "410101"; // Donaciones por Apadrinamiento - Mensualidad
const CUENTA_ICCM_INGRESO_CHILD_GIFT = "410102"; // Donaciones por Apadrinamiento - Gift
const CUENTA_ICCM_INGRESO_NON_CHILD_GIFT = "410106"; // Donaciones por Apadrinamiento - Regalos No-Niño

// ----------------------------------------------------------------------------
// Tipos del "objeto de pago" que arma la Pantalla de Cajera
// ----------------------------------------------------------------------------

/** Un arancel del año lectivo ACTUAL que ya existe como cargo pendiente (Matrícula, Papelería, Décimo Tercer Mes, Mensualidad -- con o sin beca/mora). */
export interface LineaArancelActual {
  tipo: "ARANCEL_ACTUAL";
  cargoEstudianteId: bigint;
  /** Lo que la cajera está cobrando de ESTE cargo en este recibo (puede ser un abono parcial). */
  monto: number;
}

/** Matrícula anticipada o abono a un arancel del año lectivo SIGUIENTE -- se contabiliza como pasivo (2110), no como ingreso todavía. */
export interface LineaAnticipo {
  tipo: "ANTICIPO";
  estudianteId: number;
  /** El año lectivo que se está anticipando, ej. 2027. Debe existir en `anios_lectivos`. */
  anioLectivoDestinoAnio: number;
  /** "matricula" | "papeleria" | "decimoTercero" -- tal como en `modalidad-conceptos.json`. */
  conceptoClave: "matricula" | "papeleria" | "decimoTercero";
  monto: number;
}

/** Uniformes, certificados, constancias, cartas, insignias, guías, fotocopias, exámenes extraordinarios -- no pasan por cargos_estudiante. */
export interface LineaOtroIngreso {
  tipo: "OTRO_INGRESO";
  descripcion: string; // ej. "Uniforme Escolar talla 8, Certificado de Notas..."
  cuentaContableCodigo: string; // código en el libro COLEGIO
  monto: number;
  estudianteId?: number; // opcional (ej. venta de uniforme sí lleva alumno; una constancia genérica no necesariamente)
}

/** Depósito de patrocinio ICCM (mensualidad, regalo a niño, o donación no ligada a un niño). Libro ICCM, en dólares. */
export interface LineaIccmIngreso {
  tipo: "ICCM_INGRESO";
  concepto: "MENSUALIDAD_PATROCINIO" | "CHILD_GIFT" | "NON_CHILD_GIFT";
  /** Monto bruto reportado por FMC-USA antes de comisiones. */
  montoBruto: number;
  /** Comisión bancaria internacional que ya se descontó ANTES de acreditar (0 si no hubo). */
  comisionInternacional?: number;
}

export type LineaPago = LineaArancelActual | LineaAnticipo | LineaOtroIngreso | LineaIccmIngreso;

export interface ObjetoPago {
  colegioId: number;
  fecha: Date;
  formaPago: FormaPago;
  /** Dueño del recibo, cuando aplica (una venta de uniforme "libre" o un depósito ICCM pueden no tener un alumno puntual). */
  estudianteId?: number;
  observacion?: string;
  creadoPor?: string;
  lineas: LineaPago[];
}

export interface ComprobanteGenerado {
  libro: LibroContable;
  comprobanteId: bigint;
  claveComprobante: string;
  totalDebito: number;
  totalCredito: number;
}

export interface ResultadoPago {
  reciboCajaId?: bigint;
  numeroRoc?: string;
  comprobantesGenerados: ComprobanteGenerado[];
  montoTotalCobrado: number;
  alertas: string[];
}

interface LineaContable {
  cuentaId: number;
  monto: number;
}

/** Agrupa varias líneas por cuenta contable, sumando montos (para no repetir la misma cuenta dos veces en un mismo asiento). */
export function agruparPorCuenta(lineas: LineaContable[]): LineaContable[] {
  const porCuenta = new Map<number, number>();
  for (const l of lineas) {
    porCuenta.set(l.cuentaId, (porCuenta.get(l.cuentaId) ?? 0) + l.monto);
  }
  return Array.from(porCuenta.entries()).map(([cuentaId, monto]) => ({ cuentaId, monto: Math.round((monto + Number.EPSILON) * 100) / 100 }));
}

/**
 * Crea UN comprobante balanceado: una lista de líneas Débito y una lista de
 * líneas Crédito. Valida Débito=Crédito ANTES de escribir nada -- si algo
 * no cuadra, lanza un error y toda la transacción se revierte (nunca queda
 * un comprobante "Descuadrado" guardado).
 */
export async function crearComprobanteBalanceado(
  tx: Tx,
  params: {
    colegioId: number;
    libro: LibroContable;
    tipoComprobante: "REC" | "CD" | "CK" | "CIERRE";
    origen:
      | "AUTO_RECAUDACION"
      | "AUTO_ANTICIPO"
      | "AUTO_ICCM_INGRESO"
      | "AUTO_ICCM_COMISION"
      | "AUTO_PAGO_PROVEEDOR"
      | "AUTO_NOMINA"
      | "AUTO_CIERRE";
    fecha: Date;
    concepto: string;
    debitos: LineaContable[];
    creditos: LineaContable[];
    /** Beneficiario/tercero de este comprobante (proveedor, empleado...). */
    beneficiarioId?: number;
    /** Número de factura/documento externo. */
    noDocumento?: string;
    /** Número de cheque (cuando la forma de pago es Cheque). */
    noCheque?: string;
    /**
     * Sobreescribe el `claveComprobante` calculado por defecto
     * (`"${tipoComprobante}-${numeroComprobante}"`). Úsalo para esquemas de
     * numeración propios, como el "YY-X-NN" del Módulo de Pago o el número
     * de cheque tal cual.
     */
    claveComprobanteOverride?: string;
  }
): Promise<ComprobanteGenerado> {
  const debitosAgrupados = agruparPorCuenta(params.debitos);
  const creditosAgrupados = agruparPorCuenta(params.creditos);
  const totalDebito = debitosAgrupados.reduce((s, l) => s + l.monto, 0);
  const totalCredito = creditosAgrupados.reduce((s, l) => s + l.monto, 0);

  // --- La validación que garantiza "OK - Cuadrado" ---
  const diferencia = Math.round((totalDebito - totalCredito + Number.EPSILON) * 100) / 100;
  if (Math.abs(diferencia) > 0.01) {
    throw new Error(
      `El comprobante quedaría DESCUADRADO (Débito ${totalDebito} vs Crédito ${totalCredito}, diferencia ${diferencia}). No se guarda nada -- revisa el objeto de pago.`
    );
  }

  const anio = params.fecha.getUTCFullYear();
  const mesComprobante = params.fecha.getUTCMonth() + 1;
  const anioLectivo = await tx.anioLectivo.findUnique({ where: { anio } });
  if (!anioLectivo) {
    throw new Error(`No existe el año lectivo ${anio}. Créalo antes de registrar pagos con fecha de ${anio}.`);
  }

  // --- Candado del Cierre Mensual: un mes CERRADO no admite comprobantes nuevos ---
  // Excepción deliberada: el asiento de Cierre Anual (`origen=AUTO_CIERRE`) se
  // postea A PROPÓSITO en diciembre (mes ya cerrado) como último ajuste del
  // año -- por eso se salta este candado únicamente para ese origen.
  if (params.origen !== "AUTO_CIERRE") {
    const cierre = await tx.cierreContable.findUnique({
      where: { colegioId_libro_anio_mes: { colegioId: params.colegioId, libro: params.libro, anio, mes: mesComprobante } },
    });
    if (cierre?.estado === "CERRADO") {
      throw new Error(
        `El mes ${mesComprobante}/${anio} (libro ${params.libro}) ya está CERRADO -- no se pueden registrar más comprobantes con esa fecha. Si es un error, primero hay que reabrir el cierre mensual.`
      );
    }
  }

  const numeroComprobante = await siguienteNumeroComprobante(tx, {
    colegioId: params.colegioId,
    libro: params.libro,
    tipoComprobante: params.tipoComprobante,
  });
  const claveComprobante = params.claveComprobanteOverride ?? `${params.tipoComprobante}-${numeroComprobante}`;

  const comprobante = await tx.comprobante.create({
    data: {
      colegioId: params.colegioId,
      libro: params.libro,
      tipoComprobante: params.tipoComprobante,
      numeroComprobante,
      claveComprobante,
      fecha: params.fecha,
      concepto: params.concepto,
      beneficiarioId: params.beneficiarioId,
      noDocumento: params.noDocumento,
      noCheque: params.noCheque,
      anioLectivoId: anioLectivo.id,
      mes: mesComprobante,
      origen: params.origen,
      estado: "CUADRADO",
    },
  });

  const moneda = params.libro === "ICCM" ? "USD" : "NIO";
  let numeroLinea = 1;
  for (const d of debitosAgrupados) {
    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: numeroLinea++,
        cuentaId: d.cuentaId,
        movimiento: "DEBITO",
        moneda,
        montoMonedaOrigen: d.monto,
        debitoC: d.monto,
        creditoC: 0,
      },
    });
  }
  for (const c of creditosAgrupados) {
    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: numeroLinea++,
        cuentaId: c.cuentaId,
        movimiento: "CREDITO",
        moneda,
        montoMonedaOrigen: c.monto,
        debitoC: 0,
        creditoC: c.monto,
      },
    });
  }

  return { libro: params.libro, comprobanteId: comprobante.id, claveComprobante, totalDebito, totalCredito };
}

/**
 * Procesa un cobro de la Pantalla de Cajera de principio a fin. Es la única
 * función que la interfaz de caja necesita llamar.
 */
export async function procesarPago(prisma: PrismaClient, pago: ObjetoPago): Promise<ResultadoPago> {
  if (pago.lineas.length === 0) {
    throw new Error("El pago no tiene ninguna línea que cobrar.");
  }

  return prisma.$transaction(async (tx) => {
    const alertas: string[] = [];
    const comprobantesGenerados: ComprobanteGenerado[] = [];

    const lineasColegio = pago.lineas.filter(
      (l): l is LineaArancelActual | LineaAnticipo | LineaOtroIngreso =>
        l.tipo === "ARANCEL_ACTUAL" || l.tipo === "ANTICIPO" || l.tipo === "OTRO_INGRESO"
    );
    const lineasIccm = pago.lineas.filter((l): l is LineaIccmIngreso => l.tipo === "ICCM_INGRESO");

    let reciboCajaId: bigint | undefined;
    let numeroRoc: string | undefined;
    let montoTotalCobrado = 0;

    // ========================================================================
    // A) Líneas del libro COLEGIO (aranceles, anticipos, otros ingresos)
    // ========================================================================
    if (lineasColegio.length > 0) {
      const anioTransaccion = pago.fecha.getUTCFullYear();
      const debitos: LineaContable[] = [];
      const creditos: LineaContable[] = [];
      const detallesRecibo: {
        cargoEstudianteId: bigint | null;
        conceptoId: number;
        montoPagado: number;
        incluyeRecargoMora: number;
        cuentaContableId: number;
        esAnticipo: boolean;
      }[] = [];

      const cuentaCaja = await obtenerCuenta(tx, "COLEGIO", CUENTA_CAJA_GENERAL);
      const cuentaAnticipos = await obtenerCuenta(tx, "COLEGIO", CUENTA_ANTICIPOS);

      for (const linea of lineasColegio) {
        if (linea.tipo === "ARANCEL_ACTUAL") {
          const cargo = await tx.cargoEstudiante.findUnique({
            where: { id: linea.cargoEstudianteId },
            include: { concepto: true, anioLectivo: true },
          });
          if (!cargo) throw new Error(`No existe el cargo #${linea.cargoEstudianteId}.`);

          if (cargo.anioLectivo.anio > anioTransaccion) {
            throw new Error(
              `El cargo #${cargo.id} es del año lectivo ${cargo.anioLectivo.anio} (todavía no inicia). Usa una línea de tipo ANTICIPO para cobrar años futuros, no ARANCEL_ACTUAL.`
            );
          }

          // Mora en el momento del cobro: si el concepto la aplica, ya venció
          // y todavía no se le había calculado, se le aplica AHORA mismo (no
          // hace falta esperar al job diario para que la cajera cobre bien).
          let recargoDeEsteMomento = 0;
          if (cargo.concepto.aplicaRecargoMora && cargo.recargoMoraMonto.toNumber() === 0) {
            const regla = await obtenerReglaMoraVigente(tx as unknown as PrismaClient, pago.colegioId, pago.fecha);
            const resultadoMora = evaluarMora(
              cargo.montoFacturado.toNumber(),
              cargo.saldoPendiente.toNumber(),
              cargo.fechaVencimiento,
              pago.fecha,
              { diaLimitePago: regla.diaLimitePago, porcentajeRecargo: regla.porcentajeRecargo.toNumber() },
              false
            );
            if (resultadoMora.aplicaMora) {
              recargoDeEsteMomento = resultadoMora.recargoMonto;
              await tx.cargoEstudiante.update({
                where: { id: cargo.id },
                data: {
                  recargoMoraMonto: resultadoMora.recargoMonto,
                  recargoMoraPctAplicado: resultadoMora.recargoPctAplicado,
                  saldoPendiente: cargo.saldoPendiente.toNumber() + resultadoMora.recargoMonto,
                },
              });
              alertas.push(
                `Cargo #${cargo.id}: se le aplicó recargo por mora de C$${resultadoMora.recargoMonto.toFixed(2)} al momento de cobrar (venció el ${cargo.fechaVencimiento.toISOString().slice(0, 10)}).`
              );
            }
          }

          const saldoActual = cargo.saldoPendiente.toNumber() + recargoDeEsteMomento;
          if (linea.monto > saldoActual + 0.01) {
            throw new Error(
              `El monto a cobrar (C$${linea.monto}) es mayor que el saldo pendiente del cargo #${cargo.id} (C$${saldoActual.toFixed(2)}). Si es un abono a un año futuro, usa una línea ANTICIPO.`
            );
          }

          await tx.cargoEstudiante.update({
            where: { id: cargo.id },
            data: {
              montoPagadoAcumulado: cargo.montoPagadoAcumulado.toNumber() + linea.monto,
              saldoPendiente: saldoActual - linea.monto,
              estado: saldoActual - linea.monto <= 0.01 ? "PAGADO" : "PARCIAL",
            },
          });

          creditos.push({ cuentaId: cargo.concepto.cuentaContableId, monto: linea.monto });
          detallesRecibo.push({
            cargoEstudianteId: cargo.id,
            conceptoId: cargo.conceptoId,
            montoPagado: linea.monto,
            incluyeRecargoMora: Math.min(recargoDeEsteMomento, linea.monto),
            cuentaContableId: cargo.concepto.cuentaContableId,
            esAnticipo: false,
          });
        } else if (linea.tipo === "ANTICIPO") {
          const anioDestino = await tx.anioLectivo.findUnique({ where: { anio: linea.anioLectivoDestinoAnio } });
          if (!anioDestino) {
            throw new Error(
              `No existe el año lectivo ${linea.anioLectivoDestinoAnio} -- créalo primero (aunque sea sin fechas todavía) para poder recibir anticipos de matrícula para ese año.`
            );
          }
          const estudiante = await tx.estudiante.findUniqueOrThrow({ where: { id: linea.estudianteId } });
          const mapaConceptos = await construirMapaDeConceptosPorModalidad(tx as unknown as PrismaClient);
          const modalidadVigente = await obtenerModalidadVigente(
            tx as unknown as PrismaClient,
            estudiante.id,
            estudiante.modalidadId,
            pago.fecha
          );
          const concepto = mapaConceptos[modalidadVigente.nombre]?.[linea.conceptoClave];
          if (!concepto) {
            throw new Error(
              `La modalidad "${modalidadVigente.nombre}" no tiene configurado el concepto "${linea.conceptoClave}" -- revisa modalidad-conceptos.json.`
            );
          }
          const montosBase: Record<string, number> = {
            matricula: estudiante.montoMatriculaBase.toNumber(),
            papeleria: (estudiante.montoPapeleriaBase ?? estudiante.montoMatriculaBase).toNumber(),
            decimoTercero: (estudiante.montoDecimoTercerBase ?? estudiante.montoMatriculaBase).toNumber(),
          };

          // Asegura que el cargo del año SIGUIENTE ya exista (con su beca
          // resuelta) aunque la "Apertura Anual Masiva" de ese año todavía
          // no se haya corrido -- así el anticipo siempre tiene un cargo
          // real contra el cual aplicarse.
          await crearOActualizarCargo(tx as unknown as PrismaClient, {
            estudianteId: estudiante.id,
            concepto,
            anioLectivoId: anioDestino.id,
            mes: null,
            montoBase: montosBase[linea.conceptoClave],
            fechaVencimiento: anioDestino.fechaInicio ?? new Date(Date.UTC(anioDestino.anio, 0, 31)),
            fechaEvaluacion: pago.fecha,
            advertencias: alertas,
          });

          const cargoDestino = await tx.cargoEstudiante.findUniqueOrThrow({
            where: {
              estudianteId_conceptoId_anioLectivoId_mes: {
                estudianteId: estudiante.id,
                conceptoId: concepto.id,
                anioLectivoId: anioDestino.id,
                // ponytail: mismo cast que en generar-cargos.ts (llave única tipada como number)
                mes: null as unknown as number,
              },
            },
          });
          if (linea.monto > cargoDestino.saldoPendiente.toNumber() + 0.01) {
            throw new Error(
              `El anticipo (C$${linea.monto}) es mayor que el saldo de ese cargo futuro (C$${cargoDestino.saldoPendiente.toFixed(2)}).`
            );
          }
          await tx.cargoEstudiante.update({
            where: { id: cargoDestino.id },
            data: {
              montoPagadoAcumulado: cargoDestino.montoPagadoAcumulado.toNumber() + linea.monto,
              saldoPendiente: cargoDestino.saldoPendiente.toNumber() - linea.monto,
              estado: cargoDestino.saldoPendiente.toNumber() - linea.monto <= 0.01 ? "PAGADO" : "PARCIAL",
            },
          });

          // El amarre clave de este item: se acredita el PASIVO 2110, no el
          // ingreso, porque el año lectivo destino todavía no ha iniciado.
          creditos.push({ cuentaId: cuentaAnticipos.id, monto: linea.monto });
          detallesRecibo.push({
            cargoEstudianteId: cargoDestino.id,
            conceptoId: concepto.id,
            montoPagado: linea.monto,
            incluyeRecargoMora: 0,
            cuentaContableId: cuentaAnticipos.id,
            esAnticipo: true,
          });
        } else {
          // OTRO_INGRESO
          const cuenta = await obtenerCuenta(tx, "COLEGIO", linea.cuentaContableCodigo);
          // "Otros ingresos" no tiene un ConceptoArancel dedicado -- se usa
          // el primero que ya apunte a esa misma cuenta si existe, o se dej
          // constancia en observación si no hay ninguno todavía configurado.
          const conceptoExistente = await tx.conceptoArancel.findFirst({ where: { cuentaContableId: cuenta.id } });
          if (!conceptoExistente) {
            throw new Error(
              `No hay ningún Concepto de Arancel enlazado a la cuenta ${linea.cuentaContableCodigo} -- crea uno (ej. "${linea.descripcion}") antes de poder cobrarlo desde caja.`
            );
          }
          creditos.push({ cuentaId: cuenta.id, monto: linea.monto });
          detallesRecibo.push({
            cargoEstudianteId: null,
            conceptoId: conceptoExistente.id,
            montoPagado: linea.monto,
            incluyeRecargoMora: 0,
            cuentaContableId: cuenta.id,
            esAnticipo: false,
          });
        }

        debitos.push({ cuentaId: cuentaCaja.id, monto: linea.monto });
        montoTotalCobrado += linea.monto;
      }

      const comprobante = await crearComprobanteBalanceado(tx, {
        colegioId: pago.colegioId,
        libro: "COLEGIO",
        tipoComprobante: "REC",
        origen: lineasColegio.every((l) => l.tipo === "ANTICIPO") ? "AUTO_ANTICIPO" : "AUTO_RECAUDACION",
        fecha: pago.fecha,
        concepto: pago.observacion ?? "Cobro en caja",
        debitos,
        creditos,
      });
      comprobantesGenerados.push(comprobante);

      numeroRoc = await siguienteNumeroRoc(tx, pago.colegioId);
      const totalColegio = detallesRecibo.reduce((s, d) => s + d.montoPagado, 0);
      const recibo = await tx.reciboCaja.create({
        data: {
          colegioId: pago.colegioId,
          numeroRoc,
          fecha: pago.fecha,
          estudianteId: pago.estudianteId ?? null,
          montoTotal: totalColegio,
          formaPago: pago.formaPago,
          observacion: pago.observacion,
          creadoPor: pago.creadoPor,
        },
      });
      reciboCajaId = recibo.id;

      for (const d of detallesRecibo) {
        await tx.reciboDetalle.create({
          data: {
            reciboId: recibo.id,
            cargoEstudianteId: d.cargoEstudianteId,
            conceptoId: d.conceptoId,
            montoPagado: d.montoPagado,
            incluyeRecargoMora: d.incluyeRecargoMora,
            cuentaContableId: d.cuentaContableId,
            comprobanteId: comprobante.comprobanteId,
            esAnticipo: d.esAnticipo,
          },
        });
      }

      // Alerta de saldos previos (punto 6: "la cajera debe ver
      // inmediatamente una alerta si arrastra saldos de años anteriores").
      if (pago.estudianteId) {
        const saldosPrevios = await tx.cargoEstudiante.aggregate({
          where: {
            estudianteId: pago.estudianteId,
            saldoPendiente: { gt: 0 },
            anioLectivo: { anio: { lt: anioTransaccion } },
          },
          _sum: { saldoPendiente: true },
          _count: true,
        });
        const total = saldosPrevios._sum.saldoPendiente?.toNumber() ?? 0;
        if (total > 0) {
          alertas.push(
            `⚠ Este alumno arrastra C$${total.toFixed(2)} en ${saldosPrevios._count} cargo(s) pendientes de años lectivos ANTERIORES a ${anioTransaccion}.`
          );
        }
      }
    }

    // ========================================================================
    // B) Líneas del libro ICCM (depósitos de patrocinio en dólares)
    // ========================================================================
    if (lineasIccm.length > 0) {
      const cuentaBanco = await obtenerCuenta(tx, "ICCM", CUENTA_BANCO_USD_ICCM);
      const cuentaComision = await obtenerCuenta(tx, "ICCM", CUENTA_COMISIONES_BANCARIAS_ICCM);
      const cuentaMensualidad = await obtenerCuenta(tx, "ICCM", CUENTA_ICCM_INGRESO_MENSUALIDAD);
      const cuentaChildGift = await obtenerCuenta(tx, "ICCM", CUENTA_ICCM_INGRESO_CHILD_GIFT);
      const cuentaNonChildGift = await obtenerCuenta(tx, "ICCM", CUENTA_ICCM_INGRESO_NON_CHILD_GIFT);

      const debitos: LineaContable[] = [];
      const creditos: LineaContable[] = [];

      for (const linea of lineasIccm) {
        const comision = linea.comisionInternacional ?? 0;
        const neto = Math.round((linea.montoBruto - comision + Number.EPSILON) * 100) / 100;
        const cuentaIngreso =
          linea.concepto === "MENSUALIDAD_PATROCINIO"
            ? cuentaMensualidad
            : linea.concepto === "CHILD_GIFT"
              ? cuentaChildGift
              : cuentaNonChildGift;

        // Débito: lo que realmente entra al banco (neto de comisión
        // internacional) + la comisión como gasto aparte -- juntos suman el
        // bruto, que es lo que se acredita como ingreso.
        debitos.push({ cuentaId: cuentaBanco.id, monto: neto });
        if (comision > 0) debitos.push({ cuentaId: cuentaComision.id, monto: comision });
        creditos.push({ cuentaId: cuentaIngreso.id, monto: linea.montoBruto });
        montoTotalCobrado += neto;
      }

      const comprobante = await crearComprobanteBalanceado(tx, {
        colegioId: pago.colegioId,
        libro: "ICCM",
        tipoComprobante: "CD",
        origen: "AUTO_ICCM_INGRESO",
        fecha: pago.fecha,
        concepto: pago.observacion ?? "Depósito de patrocinio ICCM",
        debitos,
        creditos,
      });
      comprobantesGenerados.push(comprobante);
    }

    return { reciboCajaId, numeroRoc, comprobantesGenerados, montoTotalCobrado, alertas };
  });
}
