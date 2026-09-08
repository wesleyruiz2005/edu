/**
 * BALANCE GENERAL CUADRADO -- vista sobre la Balanza de Comprobación,
 * agrupando por `catalogoCuenta.clase` (ACTIVO / PASIVO / PATRIMONIO), e
 * incluyendo la utilidad del periodo (Estado de Resultados) como parte del
 * Patrimonio -- así "Activo = Pasivo + Patrimonio" cuadra aunque el año
 * todavía no se haya cerrado formalmente.
 */
import type { PrismaClient } from "@prisma/client";
import { obtenerBalanzaComprobacion, type FiltroBalanza, type RenglonBalanza } from "./balanza-comprobacion";
import { obtenerEstadoResultados } from "./estado-resultados";

export interface LineaBalanceGeneral {
  cuentaCodigo: string;
  cuentaNombre: string;
  monto: number;
}

export interface BalanceGeneral {
  anio: number;
  mesHasta: number;
  activos: LineaBalanceGeneral[];
  totalActivo: number;
  pasivos: LineaBalanceGeneral[];
  totalPasivo: number;
  patrimonio: LineaBalanceGeneral[];
  totalPatrimonioSinResultado: number;
  utilidadDelPeriodo: number;
  totalPatrimonio: number;
  totalPasivoMasPatrimonio: number;
  cuadrado: boolean;
}

function aLinea(r: RenglonBalanza): LineaBalanceGeneral {
  return { cuentaCodigo: r.cuentaCodigo, cuentaNombre: r.cuentaNombre, monto: r.saldoFinal };
}

export async function obtenerBalanceGeneral(prisma: PrismaClient, filtro: FiltroBalanza): Promise<BalanceGeneral> {
  const { renglones } = await obtenerBalanzaComprobacion(prisma, filtro);
  const estadoResultados = await obtenerEstadoResultados(prisma, filtro);

  const activos = renglones.filter((r) => r.clase === "ACTIVO").map(aLinea);
  const pasivos = renglones.filter((r) => r.clase === "PASIVO").map(aLinea);
  const patrimonio = renglones.filter((r) => r.clase === "PATRIMONIO").map(aLinea);

  const totalActivo = Math.round((activos.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const totalPasivo = Math.round((pasivos.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const totalPatrimonioSinResultado = Math.round((patrimonio.reduce((s, l) => s + l.monto, 0) + Number.EPSILON) * 100) / 100;
  const utilidadDelPeriodo = estadoResultados.utilidadNeta;
  const totalPatrimonio = Math.round((totalPatrimonioSinResultado + utilidadDelPeriodo + Number.EPSILON) * 100) / 100;
  const totalPasivoMasPatrimonio = Math.round((totalPasivo + totalPatrimonio + Number.EPSILON) * 100) / 100;

  return {
    anio: filtro.anio,
    mesHasta: filtro.mesHasta ?? 12,
    activos,
    totalActivo,
    pasivos,
    totalPasivo,
    patrimonio,
    totalPatrimonioSinResultado,
    utilidadDelPeriodo,
    totalPatrimonio,
    totalPasivoMasPatrimonio,
    cuadrado: Math.abs(totalActivo - totalPasivoMasPatrimonio) <= 0.01,
  };
}
