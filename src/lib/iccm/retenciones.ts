/**
 * ============================================================================
 * ICCM -- Control de Fondos Retenidos y Liberación de Fondos
 * ============================================================================
 * Fuente: Apadrinamientos_Consolidado_2026.xlsx (hojas "Retenidos",
 * "Patrocinados (S)" y "Notas y Metodologia").
 *
 * ICCM (no este sistema) decide quién está retenido cada mes, según si la
 * foto/carta del niño está vencida -- esa decisión viene YA TOMADA en sus
 * reportes ("On Time or Overdue"). Este módulo solo REFLEJA esa decisión en
 * la contabilidad: si el reporte dice retenido, ese mes es $0 de ingreso
 * para ese niño y se genera una alerta; si dice liberado, se registra el
 * asiento de los fondos que se estaban acumulando.
 *
 * Desde 2024 los reportes históricos traen un tercer estado, "Sin dato"
 * (no Sí ni No), además de Sí/No -- ver `EstadoRetencionIccm` en el schema.
 * Por indicación de Eduardo (7 sept 2026), "Sin dato" NO se fuerza a
 * retenido ni a no-retenido: se guarda tal cual y no se le asigna $0
 * automáticamente, hasta que se verifique con la fuente real.
 */
import type { PrismaClient, EstadoRetencionIccm } from "@prisma/client";
import { siguienteNumeroComprobante, obtenerCuenta } from "../caja/comprobante-utils";

const CUENTA_BANCO_USD_ICCM = "11010401";
const CUENTA_ICCM_INGRESO_MENSUALIDAD = "410101";

export interface AlertaRetencion {
  codigoNc: string;
  nombreCompleto: string;
  motivoRetencion: string | null;
}

/**
 * Registra (o actualiza) la asignación mensual de UN niño patrocinado.
 * Si `estadoRetencion` es RETENIDO, `montoAsignado` queda en 0
 * automáticamente sin importar lo que traiga `montoBase` -- es la regla
 * exacta que pediste ("de ser así, ese mes se le asigna $0 de ingreso").
 * Si es NO_RETENIDO o SIN_DATO, se asigna el `montoBase` completo -- para
 * SIN_DATO esto es deliberado: no se asume retención sin confirmarla.
 */
export async function registrarAsignacionMensual(
  prisma: PrismaClient,
  params: {
    codigoNc: string;
    anio: number;
    mes: number;
    montoBase: number;
    estadoRetencion: EstadoRetencionIccm;
    motivoRetencion?: string;
  }
): Promise<{ montoAsignado: number; alerta: AlertaRetencion | null }> {
  const nino = await prisma.iccmNino.findUnique({ where: { codigoNc: params.codigoNc } });
  if (!nino) {
    throw new Error(`No existe ningún niño ICCM con código "${params.codigoNc}". Créalo primero en iccm_ninos.`);
  }

  const montoAsignado =
    params.estadoRetencion === "RETENIDO" ? 0 : Math.round((params.montoBase + Number.EPSILON) * 100) / 100;

  await prisma.iccmAsignacionMensual.upsert({
    where: { ninoId_anio_mes: { ninoId: nino.id, anio: params.anio, mes: params.mes } },
    create: {
      ninoId: nino.id,
      anio: params.anio,
      mes: params.mes,
      montoBase: params.montoBase,
      estadoRetencion: params.estadoRetencion,
      motivoRetencion: params.motivoRetencion,
      montoAsignado,
    },
    update: {
      montoBase: params.montoBase,
      estadoRetencion: params.estadoRetencion,
      motivoRetencion: params.motivoRetencion,
      montoAsignado,
    },
  });

  return {
    montoAsignado,
    alerta:
      params.estadoRetencion === "RETENIDO"
        ? { codigoNc: nino.codigoNc, nombreCompleto: nino.nombreCompleto, motivoRetencion: params.motivoRetencion ?? null }
        : null,
  };
}

/**
 * Carga la asignación de TODO un mes de una vez (como llegan los reportes
 * de ICCM: una lista de niños con su monto y su estado de retención), y
 * devuelve la lista de alertas visuales para mostrar en el dashboard --
 * exactamente el requisito "genera una alerta visual" del punto 4.
 */
export async function registrarAsignacionesDelMes(
  prisma: PrismaClient,
  anio: number,
  mes: number,
  ninos: Array<{ codigoNc: string; montoBase: number; estadoRetencion: EstadoRetencionIccm; motivoRetencion?: string }>
): Promise<{ totalAsignado: number; alertas: AlertaRetencion[] }> {
  const alertas: AlertaRetencion[] = [];
  let totalAsignado = 0;
  for (const n of ninos) {
    const { montoAsignado, alerta } = await registrarAsignacionMensual(prisma, { ...n, anio, mes });
    totalAsignado += montoAsignado;
    if (alerta) alertas.push(alerta);
  }
  return { totalAsignado: Math.round((totalAsignado + Number.EPSILON) * 100) / 100, alertas };
}

/**
 * Libera fondos que se habían quedado retenidos en meses anteriores (el
 * niño ya presentó su foto/carta). Genera el asiento de regularización:
 *   Débito  Banco USD (11010401)
 *   Crédito Donaciones por Apadrinamiento - Mensualidad (410101)
 * y deja registro en `iccm_ajustes_mensuales` (tipo RELEASE_FUNDS), tal
 * como aparece la línea "Release funds" en el Disbursement Advice de ICCM.
 */
export async function liberarFondosRetenidos(
  prisma: PrismaClient,
  params: { anio: number; mes: number; monto: number; descripcion?: string; fecha?: Date }
): Promise<{ ajusteId: number; comprobanteId: bigint; claveComprobante: string }> {
  const fecha = params.fecha ?? new Date(Date.UTC(params.anio, params.mes - 1, 1));

  return prisma.$transaction(async (tx) => {
    const anioLectivo = await tx.anioLectivo.findUnique({ where: { anio: params.anio } });
    if (!anioLectivo) throw new Error(`No existe el año lectivo ${params.anio}.`);

    const cuentaBanco = await obtenerCuenta(tx, "ICCM", CUENTA_BANCO_USD_ICCM);
    const cuentaIngreso = await obtenerCuenta(tx, "ICCM", CUENTA_ICCM_INGRESO_MENSUALIDAD);

    // El libro ICCM reporta a los 3 colegios a la vez (no es de un colegio
    // en particular); se ancla al primer colegio activo solo para poder
    // numerar el comprobante -- Comprobante.colegioId es NOT NULL en el
    // schema, pero el libro que de verdad importa aquí es "ICCM", no el
    // colegio.
    const colegioAncla = await tx.colegio.findFirstOrThrow({ orderBy: { id: "asc" } });
    const numeroComprobante = await siguienteNumeroComprobante(tx, {
      colegioId: colegioAncla.id,
      libro: "ICCM",
      tipoComprobante: "CD",
    });
    const claveComprobante = `CD-${numeroComprobante}`;

    const comprobante = await tx.comprobante.create({
      data: {
        colegioId: colegioAncla.id,
        libro: "ICCM",
        tipoComprobante: "CD",
        numeroComprobante,
        claveComprobante,
        fecha,
        concepto: params.descripcion ?? `Liberación de fondos retenidos (Release Funds) ${params.mes}/${params.anio}`,
        anioLectivoId: anioLectivo.id,
        mes: params.mes,
        origen: "AUTO_ICCM_LIBERACION",
        estado: "CUADRADO",
      },
    });

    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: 1,
        cuentaId: cuentaBanco.id,
        movimiento: "DEBITO",
        moneda: "USD",
        montoMonedaOrigen: params.monto,
        debitoC: params.monto,
        creditoC: 0,
      },
    });
    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: 2,
        cuentaId: cuentaIngreso.id,
        movimiento: "CREDITO",
        moneda: "USD",
        montoMonedaOrigen: params.monto,
        debitoC: 0,
        creditoC: params.monto,
      },
    });

    const ajuste = await tx.iccmAjusteMensual.create({
      data: {
        anio: params.anio,
        mes: params.mes,
        tipo: "RELEASE_FUNDS",
        monto: params.monto,
        descripcion: params.descripcion,
        comprobanteId: comprobante.id,
      },
    });

    return { ajusteId: ajuste.id, comprobanteId: comprobante.id, claveComprobante };
  });
}
