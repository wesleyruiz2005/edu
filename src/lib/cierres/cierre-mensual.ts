/**
 * ============================================================================
 * MÓDULO DE CIERRE MENSUAL
 * ============================================================================
 * Al cerrar un mes:
 *   1) Verifica que no quede ningún comprobante DESCUADRADO con fecha en ese
 *      mes (red de seguridad -- no debería pasar nunca dado el resto del
 *      sistema, pero un cierre es el último punto de control antes de
 *      "congelar" el mes).
 *   2) Genera y CONGELA (snapshot) la Balanza de Comprobación, el Estado de
 *      Resultados Acumulado y el Balance General de ese colegio, acumulados
 *      hasta ese mes.
 *   3) Marca el mes como CERRADO -- desde ese momento, `crearComprobanteBalanceado`
 *      (usado por TODOS los módulos: cobros, pagos, ICCM, nómina...) rechaza
 *      cualquier comprobante nuevo con fecha dentro de ese mes.
 *
 * `reabrirMes()` existe para el caso operativo real de "nos equivocamos,
 * hay que corregir algo del mes ya cerrado" -- vuelve a ABIERTO sin borrar
 * los snapshots anteriores (quedan sobrescritos en el próximo cierre).
 */
import type { PrismaClient, LibroContable } from "@prisma/client";
import { obtenerBalanzaComprobacion } from "../reportes/balanza-comprobacion";
import { obtenerEstadoResultados } from "../reportes/estado-resultados";
import { obtenerBalanceGeneral } from "../reportes/balance-general";

export interface ParametrosCierreMensual {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  anio: number;
  mes: number;
  cerradoPor?: string;
}

export interface ResultadoCierreMensual {
  cierreId: number;
  colegioId: number;
  libro: LibroContable;
  anio: number;
  mes: number;
  totalIngresos: number;
  totalGastos: number;
  utilidadNeta: number;
  balanceCuadrado: boolean;
}

export async function cerrarMes(prisma: PrismaClient, params: ParametrosCierreMensual): Promise<ResultadoCierreMensual> {
  const libro = params.libro ?? "COLEGIO";

  const existente = await prisma.cierreContable.findUnique({
    where: { colegioId_libro_anio_mes: { colegioId: params.colegioId, libro, anio: params.anio, mes: params.mes } },
  });
  if (existente?.estado === "CERRADO") {
    throw new Error(`El mes ${params.mes}/${params.anio} (libro ${libro}) ya está cerrado desde ${existente.fechaCierre?.toISOString().slice(0, 10)}.`);
  }

  // --- Red de seguridad: nada descuadrado puede quedar dentro de un mes que se cierra ---
  const descuadrados = await prisma.comprobante.findMany({
    where: { colegioId: params.colegioId, libro, anioLectivo: { anio: params.anio }, mes: params.mes, estado: "DESCUADRADO" },
    select: { claveComprobante: true },
  });
  if (descuadrados.length > 0) {
    throw new Error(
      `No se puede cerrar el mes ${params.mes}/${params.anio}: hay ${descuadrados.length} comprobante(s) DESCUADRADO(s) (${descuadrados.map((d) => d.claveComprobante).join(", ")}). Corrígelos antes de cerrar.`
    );
  }

  const filtroReporte = { colegioId: params.colegioId, libro, anio: params.anio, mesHasta: params.mes };
  const [balanza, estadoResultados, balanceGeneral] = await Promise.all([
    obtenerBalanzaComprobacion(prisma, filtroReporte),
    obtenerEstadoResultados(prisma, filtroReporte),
    obtenerBalanceGeneral(prisma, filtroReporte),
  ]);

  const cierre = await prisma.cierreContable.upsert({
    where: { colegioId_libro_anio_mes: { colegioId: params.colegioId, libro, anio: params.anio, mes: params.mes } },
    create: {
      colegioId: params.colegioId,
      libro,
      anio: params.anio,
      mes: params.mes,
      estado: "CERRADO",
      fechaCierre: new Date(),
      cerradoPor: params.cerradoPor,
      balanzaComprobacionJson: balanza as object,
      estadoResultadosJson: estadoResultados as object,
      balanceGeneralJson: balanceGeneral as object,
    },
    update: {
      estado: "CERRADO",
      fechaCierre: new Date(),
      cerradoPor: params.cerradoPor,
      balanzaComprobacionJson: balanza as object,
      estadoResultadosJson: estadoResultados as object,
      balanceGeneralJson: balanceGeneral as object,
    },
  });

  return {
    cierreId: cierre.id,
    colegioId: params.colegioId,
    libro,
    anio: params.anio,
    mes: params.mes,
    totalIngresos: estadoResultados.totalIngresos,
    totalGastos: estadoResultados.totalCostos + estadoResultados.totalGastos,
    utilidadNeta: estadoResultados.utilidadNeta,
    balanceCuadrado: balanceGeneral.cuadrado,
  };
}

/** Reabre un mes ya cerrado (caso operativo: hay que corregir algo). No borra los snapshots -- quedan pisados en el próximo cierre. */
export async function reabrirMes(
  prisma: PrismaClient,
  params: { colegioId: number; libro?: LibroContable; anio: number; mes: number }
): Promise<void> {
  const libro = params.libro ?? "COLEGIO";
  await prisma.cierreContable.update({
    where: { colegioId_libro_anio_mes: { colegioId: params.colegioId, libro, anio: params.anio, mes: params.mes } },
    data: { estado: "ABIERTO" },
  });
}
