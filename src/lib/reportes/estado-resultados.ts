/**
 * ESTADO DE RESULTADOS ACUMULADO -- vista sobre la Balanza de Comprobación,
 * agrupando por `catalogoCuenta.clase` (INGRESO / COSTO / GASTO), tal como
 * quedó decidido en diseno-base-datos.md.
 */
import type { PrismaClient } from "@prisma/client";
import { obtenerBalanzaComprobacion, type FiltroBalanza, type RenglonBalanza } from "./balanza-comprobacion";

export interface LineaEstadoResultados {
  cuentaCodigo: string;
  cuentaNombre: string;
  monto: number;
}

export interface EstadoResultados {
  anio: number;
  mesHasta: number;
  ingresos: LineaEstadoResultados[];
  totalIngresos: number;
  costos: LineaEstadoResultados[];
  totalCostos: number;
  gastos: LineaEstadoResultados[];
  totalGastos: number;
  utilidadBruta: number;
  utilidadNeta: number;
}

function aLinea(r: RenglonBalanza): LineaEstadoResultados {
  return { cuentaCodigo: r.cuentaCodigo, cuentaNombre: r.cuentaNombre, monto: r.saldoFinal };
}

export async function obtenerEstadoResultados(prisma: PrismaClient, filtro: FiltroBalanza): Promise<EstadoResultados> {
  const { renglones } = await obtenerBalanzaComprobacion(prisma, filtro);

  const ingresos = renglones.filter((r) => r.clase === "INGRESO").map(aLinea);
  const costos = renglones.filter((r) => r.clase === "COSTO").map(aLinea);
  const gastos = renglones.filter((r) => r.clase === "GASTO").map(aLinea);

  const totalIngresos = Math.round((ingresos.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const totalCostos = Math.round((costos.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const totalGastos = Math.round((gastos.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const utilidadBruta = Math.round((totalIngresos - totalCostos + Number.EPSILON) * 100) / 100;
  const utilidadNeta = Math.round((utilidadBruta - totalGastos + Number.EPSILON) * 100) / 100;

  return {
    anio: filtro.anio,
    mesHasta: filtro.mesHasta ?? 12,
    ingresos,
    totalIngresos,
    costos,
    totalCostos,
    gastos,
    totalGastos,
    utilidadBruta,
    utilidadNeta,
  };
}
