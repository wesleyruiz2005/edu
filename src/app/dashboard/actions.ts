"use server";

/**
 * Server Actions del Dashboard Consolidado de la Junta Directiva (punto 4).
 * Todo lo que necesita el tablero -- indicadores globales, ingresos por
 * sede, top de morosidad, la sección especial ICCM, y las descargas a Excel
 * de los 5 estados financieros -- vive aquí, sobre los reportes que ya
 * existían en `src/lib/reportes`.
 */
import { prisma } from "../../lib/prisma";
import { obtenerBalanzaComprobacion } from "../../lib/reportes/balanza-comprobacion";
import { obtenerEstadoResultados } from "../../lib/reportes/estado-resultados";
import { obtenerBalanceGeneral } from "../../lib/reportes/balance-general";
import { obtenerLibroDiario } from "../../lib/reportes/libro-diario";
import { obtenerLibroMayor } from "../../lib/reportes/libro-mayor";
import { obtenerTopSeccionesMorosidad, type SeccionMorosidad } from "../../lib/reportes/morosidad";
import { obtenerNinosRetenidosDelMes, obtenerComisionesBacDelAnio, type NinoRetenidoAuditoria, type ComisionBacMes } from "../../lib/reportes/iccm-auditoria";
import {
  exportarBalanzaComprobacion,
  exportarEstadoResultados,
  exportarBalanceGeneral,
  exportarLibroDiario,
  exportarLibroMayor,
} from "../../lib/exportar/exportar-estados-financieros";
import { exportarTopMorosidad, exportarNinosRetenidosIccm, exportarComisionesBac } from "../../lib/exportar/exportar-dashboard";
import type { ResultadoDescargaExcel } from "../../lib/exportar/excel";

export interface ColegioOpcion {
  id: number;
  codigo: string;
  nombre: string;
}

export async function listarColegiosDashboardAction(): Promise<ColegioOpcion[]> {
  return prisma.colegio.findMany({ orderBy: { nombre: "asc" }, select: { id: true, codigo: true, nombre: true } });
}

export interface IndicadoresGlobales {
  colegioNombre: string;
  totalIngresosMes: number;
  totalGastosMes: number;
  utilidadMes: number;
  saldoTotalPendiente: number;
  saldoVencidoTotal: number;
  cuadrado: boolean;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function obtenerIndicadoresAction(anio: number, mes: number, colegioId?: number): Promise<IndicadoresGlobales> {
  const filtro = { colegioId, anio, mesHasta: mes };
  const [estadoResultados, balanceGeneral] = await Promise.all([
    obtenerEstadoResultados(prisma, filtro),
    obtenerBalanceGeneral(prisma, filtro),
  ]);

  const filtroEstudiante = colegioId ? { estudiante: { colegioId } } : {};
  const [pendienteAgg, vencidoAgg, colegio] = await Promise.all([
    prisma.cargoEstudiante.aggregate({ where: { saldoPendiente: { gt: 0 }, ...filtroEstudiante }, _sum: { saldoPendiente: true } }),
    prisma.cargoEstudiante.aggregate({
      where: { saldoPendiente: { gt: 0 }, fechaVencimiento: { lt: new Date() }, ...filtroEstudiante },
      _sum: { saldoPendiente: true },
    }),
    colegioId ? prisma.colegio.findUnique({ where: { id: colegioId } }) : Promise.resolve(null),
  ]);

  return {
    colegioNombre: colegio?.nombre ?? "Consolidado (3 sedes)",
    totalIngresosMes: estadoResultados.totalIngresos,
    totalGastosMes: redondear(estadoResultados.totalCostos + estadoResultados.totalGastos),
    utilidadMes: estadoResultados.utilidadNeta,
    saldoTotalPendiente: pendienteAgg._sum.saldoPendiente?.toNumber() ?? 0,
    saldoVencidoTotal: vencidoAgg._sum.saldoPendiente?.toNumber() ?? 0,
    cuadrado: balanceGeneral.cuadrado,
  };
}

export interface IngresoPorSede {
  colegioId: number;
  colegioNombre: string;
  totalIngresos: number;
}

export async function obtenerIngresosPorSedeAction(anio: number, mes: number): Promise<IngresoPorSede[]> {
  const colegios = await prisma.colegio.findMany({ orderBy: { nombre: "asc" } });
  const resultados: IngresoPorSede[] = [];
  for (const c of colegios) {
    const er = await obtenerEstadoResultados(prisma, { colegioId: c.id, anio, mesHasta: mes });
    resultados.push({ colegioId: c.id, colegioNombre: c.nombre, totalIngresos: er.totalIngresos });
  }
  return resultados;
}

export async function obtenerTopMorosidadAction(colegioId?: number): Promise<SeccionMorosidad[]> {
  return obtenerTopSeccionesMorosidad(prisma, { colegioId, limite: 5 });
}

export async function obtenerNinosRetenidosAction(anio: number, mes: number): Promise<NinoRetenidoAuditoria[]> {
  return obtenerNinosRetenidosDelMes(prisma, { anio, mes });
}

export async function obtenerComisionesBacAction(anio: number): Promise<ComisionBacMes[]> {
  return obtenerComisionesBacDelAnio(prisma, anio);
}

// ============================================================================
// Descargas a Excel -- los 5 estados financieros formales + los reportes
// especiales del dashboard.
// ============================================================================

export async function exportarBalanzaDashboardAction(anio: number, mes: number, colegioId?: number): Promise<ResultadoDescargaExcel> {
  try {
    const balanza = await obtenerBalanzaComprobacion(prisma, { colegioId, anio, mesHasta: mes });
    const etiqueta = `${colegioId ? `Colegio${colegioId}` : "Consolidado"}_${anio}-${String(mes).padStart(2, "0")}`;
    return { ok: true, ...exportarBalanzaComprobacion(balanza, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando la Balanza de Comprobación." };
  }
}

export async function exportarEstadoResultadosDashboardAction(anio: number, mes: number, colegioId?: number): Promise<ResultadoDescargaExcel> {
  try {
    const er = await obtenerEstadoResultados(prisma, { colegioId, anio, mesHasta: mes });
    const etiqueta = colegioId ? `Colegio${colegioId}` : "Consolidado";
    return { ok: true, ...exportarEstadoResultados(er, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando el Estado de Resultados." };
  }
}

export async function exportarBalanceGeneralDashboardAction(anio: number, mes: number, colegioId?: number): Promise<ResultadoDescargaExcel> {
  try {
    const bg = await obtenerBalanceGeneral(prisma, { colegioId, anio, mesHasta: mes });
    const etiqueta = colegioId ? `Colegio${colegioId}` : "Consolidado";
    return { ok: true, ...exportarBalanceGeneral(bg, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando el Balance General." };
  }
}

/** Libro Diario es SIEMPRE de un colegio específico (no existe un "libro diario consolidado" -- cada sede lleva el suyo). */
export async function exportarLibroDiarioDashboardAction(colegioId: number, anio: number, mes?: number): Promise<ResultadoDescargaExcel> {
  try {
    const asientos = await obtenerLibroDiario(prisma, { colegioId, anio, mes });
    const etiqueta = `Colegio${colegioId}_${anio}${mes ? `-${String(mes).padStart(2, "0")}` : "-completo"}`;
    return { ok: true, ...exportarLibroDiario(asientos, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando el Libro Diario." };
  }
}

/** Libro Mayor es por CUENTA específica de un colegio (igual que en el Excel real de Eduardo: una hoja por cuenta). */
export async function exportarLibroMayorDashboardAction(
  colegioId: number,
  cuentaCodigo: string,
  anio: number,
  mesDesde?: number,
  mesHasta?: number
): Promise<ResultadoDescargaExcel> {
  try {
    const mayor = await obtenerLibroMayor(prisma, { colegioId, cuentaCodigo, anio, mesDesde, mesHasta });
    const etiqueta = `Colegio${colegioId}_${anio}`;
    return { ok: true, ...exportarLibroMayor(mayor, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando el Libro Mayor." };
  }
}

export async function exportarTopMorosidadAction(colegioId?: number): Promise<ResultadoDescargaExcel> {
  try {
    const filas = await obtenerTopSeccionesMorosidad(prisma, { colegioId, limite: 5 });
    return { ok: true, ...exportarTopMorosidad(filas) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando el top de morosidad." };
  }
}

export async function exportarNinosRetenidosAction(anio: number, mes: number): Promise<ResultadoDescargaExcel> {
  try {
    const ninos = await obtenerNinosRetenidosDelMes(prisma, { anio, mes });
    return { ok: true, ...exportarNinosRetenidosIccm(ninos, `${anio}-${String(mes).padStart(2, "0")}`) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando los niños retenidos ICCM." };
  }
}

export async function exportarComisionesBacAction(anio: number): Promise<ResultadoDescargaExcel> {
  try {
    const comisiones = await obtenerComisionesBacDelAnio(prisma, anio);
    return { ok: true, ...exportarComisionesBac(comisiones, anio) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error exportando las comisiones BAC." };
  }
}
