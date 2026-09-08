/**
 * ============================================================================
 * BALANZA DE COMPROBACIÓN (en tiempo real, y "Balanza Total" consolidada)
 * ============================================================================
 * Tal como quedó decidido en diseno-base-datos.md: es una VISTA, no una
 * tabla -- suma `saldos_iniciales` + SUM(débito)/SUM(crédito) de
 * `asientos_contables` agrupado por cuenta. Si `colegioId` se omite, es la
 * "Balanza Total" consolidada de los 3 colegios para la Junta Administrativa
 * (punto 1 de la especificación del proyecto), sin necesidad de copiar nada
 * a mano.
 */
import type { PrismaClient, LibroContable, ClaseCuenta, NaturalezaCuenta } from "@prisma/client";

export interface RenglonBalanza {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  clase: ClaseCuenta;
  naturaleza: NaturalezaCuenta;
  /** Saldo inicial del año, ya con signo natural (positivo = del lado de su naturaleza). */
  saldoInicial: number;
  debeAcumulado: number;
  haberAcumulado: number;
  /** saldoInicial + efecto acumulado de los movimientos, con signo natural. */
  saldoFinal: number;
}

export interface FiltroBalanza {
  /** Omitir = consolidado de los 3 colegios (sin filtrar). */
  colegioId?: number;
  libro?: LibroContable; // default "COLEGIO"
  anio: number;
  /** Acumulado HASTA este mes (inclusive). Default 12 (año completo). */
  mesHasta?: number;
}

export interface ResultadoBalanza {
  renglones: RenglonBalanza[];
  totalDebe: number;
  totalHaber: number;
  cuadrado: boolean;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function obtenerBalanzaComprobacion(prisma: PrismaClient, filtro: FiltroBalanza): Promise<ResultadoBalanza> {
  const libro = filtro.libro ?? "COLEGIO";
  const mesHasta = filtro.mesHasta ?? 12;

  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio: filtro.anio } });

  const cuentas = await prisma.catalogoCuenta.findMany({
    where: { libro, tipoCuenta: "DETALLE", activo: true },
    orderBy: { codigo: "asc" },
  });

  const saldosIniciales = anioLectivo
    ? await prisma.saldoInicial.groupBy({
        by: ["cuentaId"],
        where: { anioLectivoId: anioLectivo.id, ...(filtro.colegioId ? { colegioId: filtro.colegioId } : {}) },
        _sum: { debeInicial: true, haberInicial: true },
      })
    : [];
  const mapaSaldoInicial = new Map(saldosIniciales.map((s) => [s.cuentaId, s]));

  const movimientos = await prisma.asientoContable.groupBy({
    by: ["cuentaId"],
    where: {
      comprobante: {
        libro,
        anioLectivo: { anio: filtro.anio },
        mes: { lte: mesHasta },
        ...(filtro.colegioId ? { colegioId: filtro.colegioId } : {}),
      },
    },
    _sum: { debitoC: true, creditoC: true },
  });
  const mapaMovimientos = new Map(movimientos.map((m) => [m.cuentaId, m]));

  const renglones: RenglonBalanza[] = [];
  let totalDebe = 0;
  let totalHaber = 0;

  for (const cuenta of cuentas) {
    const si = mapaSaldoInicial.get(cuenta.id);
    const mov = mapaMovimientos.get(cuenta.id);
    const debeInicial = si?._sum.debeInicial?.toNumber() ?? 0;
    const haberInicial = si?._sum.haberInicial?.toNumber() ?? 0;
    const debeAcumulado = mov?._sum.debitoC?.toNumber() ?? 0;
    const haberAcumulado = mov?._sum.creditoC?.toNumber() ?? 0;

    if (debeInicial === 0 && haberInicial === 0 && debeAcumulado === 0 && haberAcumulado === 0) continue; // omite cuentas sin movimiento

    const saldoInicial = cuenta.naturaleza === "DEUDORA" ? debeInicial - haberInicial : haberInicial - debeInicial;
    const efectoMovimientos = cuenta.naturaleza === "DEUDORA" ? debeAcumulado - haberAcumulado : haberAcumulado - debeAcumulado;
    const saldoFinal = redondear(saldoInicial + efectoMovimientos);

    renglones.push({
      cuentaId: cuenta.id,
      cuentaCodigo: cuenta.codigo,
      cuentaNombre: cuenta.nombre,
      clase: cuenta.clase,
      naturaleza: cuenta.naturaleza,
      saldoInicial: redondear(saldoInicial),
      debeAcumulado: redondear(debeInicial + debeAcumulado),
      haberAcumulado: redondear(haberInicial + haberAcumulado),
      saldoFinal,
    });
    totalDebe += debeInicial + debeAcumulado;
    totalHaber += haberInicial + haberAcumulado;
  }

  totalDebe = redondear(totalDebe);
  totalHaber = redondear(totalHaber);

  return { renglones, totalDebe, totalHaber, cuadrado: Math.abs(totalDebe - totalHaber) <= 0.01 };
}
