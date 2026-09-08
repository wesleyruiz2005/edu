import type { PrismaClient } from "@prisma/client";
import { evaluarMora } from "./reglas";
import { obtenerReglaMoraVigente } from "./regla-mora-vigente";

export interface ResumenMora {
  cargosRevisados: number;
  cargosConMoraNueva: number;
  montoTotalRecargos: number;
  advertencias: string[];
}

/**
 * ============================================================================
 * 2) CÁLCULO AUTOMÁTICO DE MORA -- recargo del 10% después del día 5
 * ============================================================================
 * Recorre los cargos vencidos y sin pagar de un colegio (o de los 3, si no
 * se indica colegioId) y les aplica el recargo, exactamente como hoy se
 * anota a mano en Detalle de Caja ("APLICADA MORA 10%").
 *
 * Pensado para correrse una vez al día (ej. una tarea programada a las
 * 6:00 a.m.) — es seguro correrlo varias veces el mismo día: un cargo que
 * ya tiene `recargo_mora_monto > 0` nunca se le vuelve a sumar otro recargo.
 *
 * Solo revisa conceptos marcados `aplica_recargo_mora = true` en el
 * catálogo -- hoy en día eso es únicamente la Mensualidad (y su
 * equivalente en Cursos Libres, Carreras Técnicas e ICCM), tal como pediste:
 * "el recargo del 10% ... sobre la mensualidad".
 */
export async function aplicarRecargosPorMora(
  prisma: PrismaClient,
  params: { colegioId?: number; fechaEvaluacion?: Date }
): Promise<ResumenMora> {
  const fechaEvaluacion = params.fechaEvaluacion ?? new Date();
  const resumen: ResumenMora = {
    cargosRevisados: 0,
    cargosConMoraNueva: 0,
    montoTotalRecargos: 0,
    advertencias: [],
  };

  const cargosCandidatos = await prisma.cargoEstudiante.findMany({
    where: {
      recargoMoraMonto: 0,
      saldoPendiente: { gt: 0 },
      fechaVencimiento: { lt: fechaEvaluacion },
      concepto: { aplicaRecargoMora: true },
      ...(params.colegioId ? { estudiante: { colegioId: params.colegioId } } : {}),
    },
    include: { estudiante: true },
  });

  // Cacheamos la regla de mora por colegio para no consultarla una y otra
  // vez dentro del ciclo (normalmente son 1-3 colegios, no miles).
  const reglasPorColegio = new Map<number, Awaited<ReturnType<typeof obtenerReglaMoraVigente>>>();

  for (const cargo of cargosCandidatos) {
    resumen.cargosRevisados++;
    const colegioId = cargo.estudiante.colegioId;

    let regla = reglasPorColegio.get(colegioId);
    if (!regla) {
      try {
        regla = await obtenerReglaMoraVigente(prisma, colegioId, fechaEvaluacion);
        reglasPorColegio.set(colegioId, regla);
      } catch (e) {
        resumen.advertencias.push((e as Error).message);
        continue;
      }
    }

    const resultado = evaluarMora(
      cargo.montoFacturado.toNumber(),
      cargo.saldoPendiente.toNumber(),
      cargo.fechaVencimiento,
      fechaEvaluacion,
      { diaLimitePago: regla.diaLimitePago, porcentajeRecargo: regla.porcentajeRecargo.toNumber() },
      cargo.recargoMoraMonto.toNumber() > 0
    );

    if (!resultado.aplicaMora) continue;

    await prisma.cargoEstudiante.update({
      where: { id: cargo.id },
      data: {
        recargoMoraMonto: resultado.recargoMonto,
        recargoMoraPctAplicado: resultado.recargoPctAplicado,
        saldoPendiente: cargo.saldoPendiente.toNumber() + resultado.recargoMonto,
        estado: "VENCIDO",
      },
    });

    resumen.cargosConMoraNueva++;
    resumen.montoTotalRecargos += resultado.recargoMonto;
  }

  resumen.montoTotalRecargos = Math.round((resumen.montoTotalRecargos + Number.EPSILON) * 100) / 100;
  return resumen;
}
