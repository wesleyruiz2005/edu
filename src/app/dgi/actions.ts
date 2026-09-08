"use server";

import { prisma } from "../../lib/prisma";
import { obtenerRetencionesDgiDelMes, exportarRetencionesDgiAExcel, type ReporteRetencionesDgi } from "../../lib/reportes/retenciones-dgi";
import type { ResultadoDescargaExcel } from "../../lib/exportar/excel";

export async function obtenerRetencionesDgiAction(anio: number, mes: number, colegioId?: number): Promise<ReporteRetencionesDgi> {
  return obtenerRetencionesDgiDelMes(prisma, { anio, mes, colegioId });
}

export async function exportarRetencionesDgiAction(anio: number, mes: number, colegioId?: number): Promise<ResultadoDescargaExcel> {
  try {
    const reporte = await obtenerRetencionesDgiDelMes(prisma, { anio, mes, colegioId });
    const { base64, nombreArchivo } = exportarRetencionesDgiAExcel(reporte);
    return { ok: true, base64, nombreArchivo };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado exportando las retenciones DGI." };
  }
}

export async function listarColegiosDgiAction() {
  return prisma.colegio.findMany({ orderBy: { nombre: "asc" }, select: { id: true, codigo: true, nombre: true } });
}
