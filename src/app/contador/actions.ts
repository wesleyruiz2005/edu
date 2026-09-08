"use server";

/**
 * Server Actions de la pantalla de Contador (punto 4 del pedido de Eduardo,
 * 7 sept 2026): Libro Diario, Libro Mayor y Cierres Mensuales/Anuales.
 * No son reportes nuevos -- son los mismos `src/lib/reportes/libro-diario.ts`
 * / `libro-mayor.ts` y `src/lib/cierres/*` que ya alimentaban el Dashboard
 * de la Junta, ahora con su propia pantalla dedicada para el rol Contador.
 */
import { prisma } from "../../lib/prisma";
import { obtenerLibroDiario, type AsientoLibroDiario } from "../../lib/reportes/libro-diario";
import { obtenerLibroMayor, type LibroMayorCuenta } from "../../lib/reportes/libro-mayor";
import { exportarLibroDiario, exportarLibroMayor } from "../../lib/exportar/exportar-estados-financieros";
import type { ResultadoDescargaExcel } from "../../lib/exportar/excel";
import { cerrarMes, reabrirMes, type ResultadoCierreMensual } from "../../lib/cierres/cierre-mensual";
import { cerrarAnio, type ResultadoCierreAnual } from "../../lib/cierres/cierre-anual";

export interface ColegioOpcion {
  id: number;
  codigo: string;
  nombre: string;
}

export async function listarColegiosContadorAction(): Promise<ColegioOpcion[]> {
  return prisma.colegio.findMany({ orderBy: { nombre: "asc" }, select: { id: true, codigo: true, nombre: true } });
}

// --- Libro Diario -----------------------------------------------------------

export async function obtenerLibroDiarioAction(colegioId: number, anio: number, mes?: number): Promise<AsientoLibroDiario[]> {
  return obtenerLibroDiario(prisma, { colegioId, anio, mes });
}

export async function exportarLibroDiarioAction(colegioId: number, anio: number, mes?: number): Promise<ResultadoDescargaExcel> {
  try {
    const asientos = await obtenerLibroDiario(prisma, { colegioId, anio, mes });
    const colegio = await prisma.colegio.findUnique({ where: { id: colegioId }, select: { codigo: true } });
    const etiqueta = `${colegio?.codigo ?? colegioId}_${anio}${mes ? `-${String(mes).padStart(2, "0")}` : ""}`;
    return { ok: true, ...exportarLibroDiario(asientos, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo exportar el Libro Diario." };
  }
}

// --- Libro Mayor --------------------------------------------------------------

export async function obtenerLibroMayorAction(
  colegioId: number,
  cuentaCodigo: string,
  anio: number,
  mesDesde?: number,
  mesHasta?: number
): Promise<LibroMayorCuenta | null> {
  if (!cuentaCodigo.trim()) return null;
  return obtenerLibroMayor(prisma, { colegioId, cuentaCodigo: cuentaCodigo.trim(), anio, mesDesde, mesHasta });
}

export async function exportarLibroMayorAction(
  colegioId: number,
  cuentaCodigo: string,
  anio: number,
  mesDesde?: number,
  mesHasta?: number
): Promise<ResultadoDescargaExcel> {
  try {
    const mayor = await obtenerLibroMayor(prisma, { colegioId, cuentaCodigo: cuentaCodigo.trim(), anio, mesDesde, mesHasta });
    const colegio = await prisma.colegio.findUnique({ where: { id: colegioId }, select: { codigo: true } });
    const etiqueta = `${colegio?.codigo ?? colegioId}_${cuentaCodigo.trim()}_${anio}`;
    return { ok: true, ...exportarLibroMayor(mayor, etiqueta) };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo exportar el Libro Mayor." };
  }
}

// --- Cierres --------------------------------------------------------------

export interface CierreMensualEstado {
  mes: number;
  estado: "ABIERTO" | "CERRADO";
  fechaCierre: string | null;
}

export async function listarCierresMensualesAction(colegioId: number, anio: number): Promise<CierreMensualEstado[]> {
  const cierres = await prisma.cierreContable.findMany({
    where: { colegioId, libro: "COLEGIO", anio },
    select: { mes: true, estado: true, fechaCierre: true },
    orderBy: { mes: "asc" },
  });
  const porMes = new Map(cierres.map((c) => [c.mes, c]));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    const existente = porMes.get(mes);
    return {
      mes,
      estado: existente?.estado ?? "ABIERTO",
      fechaCierre: existente?.fechaCierre ? existente.fechaCierre.toISOString().slice(0, 10) : null,
    };
  });
}

export interface ResultadoCierreAccion {
  ok: boolean;
  mensaje?: string;
  resultado?: ResultadoCierreMensual;
}

export async function cerrarMesAction(colegioId: number, anio: number, mes: number, cerradoPor?: string): Promise<ResultadoCierreAccion> {
  try {
    const resultado = await cerrarMes(prisma, { colegioId, anio, mes, cerradoPor });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo cerrar el mes." };
  }
}

export async function reabrirMesAction(colegioId: number, anio: number, mes: number): Promise<{ ok: boolean; mensaje?: string }> {
  try {
    await reabrirMes(prisma, { colegioId, anio, mes });
    return { ok: true };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo reabrir el mes." };
  }
}

export interface ResultadoCierreAnualAccion {
  ok: boolean;
  mensaje?: string;
  resultado?: ResultadoCierreAnual;
}

export async function cerrarAnioAction(colegioId: number, anio: number, cerradoPor?: string): Promise<ResultadoCierreAnualAccion> {
  try {
    const resultado = await cerrarAnio(prisma, { colegioId, anio, cerradoPor });
    return { ok: true, resultado };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "No se pudo cerrar el año. Revisa que los 12 meses estén cerrados." };
  }
}
