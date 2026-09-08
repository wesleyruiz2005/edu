/**
 * ============================================================================
 * ICCM -- Comisiones Bancarias (Banco Nacional BAC Nicaragua)
 * ============================================================================
 * Fuente: Apadrinamientos_Consolidado_2026.xlsx, hoja "Notas y Metodologia",
 * CORREGIDA el 7 sept 2026 con la aclaración directa de Eduardo:
 *
 * Cada transferencia de FMC USA hacia Nicaragua paga DOS comisiones
 * bancarias distintas, y ambas son VARIABLES (ninguna es un monto fijo
 * real, aunque una versión anterior de esta nota decía lo contrario):
 *   1. Comisión del banco EXTRANJERO (Estados Unidos) -- se descuenta ANTES
 *      de acreditarse, ronda los US$5. Esta se registra dentro de
 *      `procesarPago()` (línea ICCM_INGRESO, campo `comisionInternacional`)
 *      en el momento en que se recibe la transferencia.
 *   2. Comisión del banco NACIONAL (BAC Nicaragua) -- llega como un débito
 *      APARTE y POSTERIOR en el estado de cuenta, ronda los US$25, y varía
 *      según cuánto ingresa cada mes. ESTA es la que registra la función de
 *      este archivo, `registrarComisionBacMensual()`.
 *
 * Como ninguna de las dos es realmente "fija", esta función YA NO asume un
 * valor por defecto -- el monto se debe informar cada mes con lo que
 * muestre el estado de cuenta real de BAC.
 */
import type { PrismaClient } from "@prisma/client";
import { siguienteNumeroComprobante, obtenerCuenta } from "../caja/comprobante-utils";

const CUENTA_BANCO_USD_ICCM = "11010401";
const CUENTA_COMISIONES_BANCARIAS_ICCM = "620601";

export async function registrarComisionBacMensual(
  prisma: PrismaClient,
  params: { anio: number; mes: number; montoComisionBac: number; fecha?: Date }
): Promise<{ comprobanteId: bigint; claveComprobante: string; monto: number }> {
  const monto = params.montoComisionBac; // variable mes a mes -- viene del estado de cuenta real de BAC, no se asume ningún valor
  const fecha = params.fecha ?? new Date(Date.UTC(params.anio, params.mes - 1, 28));

  return prisma.$transaction(async (tx) => {
    const anioLectivo = await tx.anioLectivo.findUnique({ where: { anio: params.anio } });
    if (!anioLectivo) throw new Error(`No existe el año lectivo ${params.anio}.`);

    const conciliacionExistente = await tx.iccmConciliacionMensual.findUnique({
      where: { anio_mes: { anio: params.anio, mes: params.mes } },
    });
    if (conciliacionExistente?.comisionBacRegistrada) {
      throw new Error(
        `La comisión BAC de ${params.mes}/${params.anio} ya se registró (comprobante #${conciliacionExistente.comprobanteComisionId}). No se duplica.`
      );
    }

    const cuentaBanco = await obtenerCuenta(tx, "ICCM", CUENTA_BANCO_USD_ICCM);
    const cuentaComision = await obtenerCuenta(tx, "ICCM", CUENTA_COMISIONES_BANCARIAS_ICCM);
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
        concepto: `Comisión Banco Nacional BAC ${params.mes}/${params.anio}`,
        anioLectivoId: anioLectivo.id,
        mes: params.mes,
        origen: "AUTO_ICCM_COMISION",
        estado: "CUADRADO",
      },
    });

    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: 1,
        cuentaId: cuentaComision.id,
        movimiento: "DEBITO",
        moneda: "USD",
        montoMonedaOrigen: monto,
        debitoC: monto,
        creditoC: 0,
      },
    });
    await tx.asientoContable.create({
      data: {
        comprobanteId: comprobante.id,
        numeroLinea: 2,
        cuentaId: cuentaBanco.id,
        movimiento: "CREDITO",
        moneda: "USD",
        montoMonedaOrigen: monto,
        debitoC: 0,
        creditoC: monto,
      },
    });

    await tx.iccmConciliacionMensual.upsert({
      where: { anio_mes: { anio: params.anio, mes: params.mes } },
      create: {
        anio: params.anio,
        mes: params.mes,
        totalReportadoFmc: 0,
        totalEsperadoAcreditado: 0,
        comisionBacNacional: monto,
        comisionBacRegistrada: true,
        comprobanteComisionId: comprobante.id,
      },
      update: { comisionBacNacional: monto, comisionBacRegistrada: true, comprobanteComisionId: comprobante.id },
    });

    return { comprobanteId: comprobante.id, claveComprobante, monto };
  });
}
