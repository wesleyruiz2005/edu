"use server";

/**
 * Server Actions de la Pantalla de Nómina -- listar planillas ya registradas
 * (por `registrarPlanillaMensual`/`jornalizarPlanilla`) y exportarlas a
 * Excel (punto 1 de la especificación).
 */
import { prisma } from "../../lib/prisma";
import { obtenerPlanillaParaExportar, exportarPlanillaAExcel } from "../../lib/nomina/exportar-nomina";
import type { ResultadoDescargaExcel } from "../../lib/exportar/excel";

export interface PlanillaResumen {
  id: number;
  colegioNombre: string;
  tipoNomina: string;
  anio: number;
  mes: number;
  estado: string;
  totalEmpleados: number;
  totalNeto: number;
}

export async function listarPlanillasAction(): Promise<PlanillaResumen[]> {
  const planillas = await prisma.planillaMensual.findMany({
    include: { colegio: true, detalle: true },
    orderBy: [{ anio: "desc" }, { mes: "desc" }, { colegio: { nombre: "asc" } }],
  });
  return planillas.map((p) => ({
    id: p.id,
    colegioNombre: p.colegio.nombre,
    tipoNomina: p.tipoNomina,
    anio: p.anio,
    mes: p.mes,
    estado: p.estado,
    totalEmpleados: p.detalle.length,
    totalNeto: Math.round((p.detalle.reduce((s, d) => s + d.salarioNeto.toNumber(), 0) + Number.EPSILON) * 100) / 100,
  }));
}

export async function exportarPlanillaAction(planillaId: number): Promise<ResultadoDescargaExcel> {
  try {
    const planilla = await obtenerPlanillaParaExportar(prisma, planillaId);
    if (planilla.filas.length === 0) {
      return { ok: false, mensaje: "Esta planilla no tiene ningún empleado registrado todavía." };
    }
    const { base64, nombreArchivo } = exportarPlanillaAExcel(planilla);
    return { ok: true, base64, nombreArchivo };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado exportando la nómina." };
  }
}
