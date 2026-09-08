/**
 * ============================================================================
 * MÓDULO LIBRO MAYOR
 * ============================================================================
 * Reporte por CUENTA contable: todos los movimientos que la afectaron en un
 * periodo, con saldo corriente (saldo inicial + movimientos = saldo final).
 * Igual que el Libro Diario, no crea tablas nuevas -- lee `AsientoContable`.
 */
import type { PrismaClient, LibroContable, NaturalezaCuenta } from "@prisma/client";

export interface MovimientoLibroMayor {
  fecha: Date;
  claveComprobante: string;
  concepto: string | null;
  debitoC: number;
  creditoC: number;
  saldoAcumulado: number;
}

export interface LibroMayorCuenta {
  cuentaId: number;
  cuentaCodigo: string;
  cuentaNombre: string;
  naturaleza: NaturalezaCuenta;
  saldoInicial: number;
  movimientos: MovimientoLibroMayor[];
  totalDebito: number;
  totalCredito: number;
  saldoFinal: number;
}

export interface FiltroLibroMayor {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  cuentaCodigo: string;
  anio: number;
  mesDesde?: number; // default 1
  mesHasta?: number; // default 12
}

/** El efecto de un movimiento sobre el saldo depende de la naturaleza de la cuenta (Deudora suma en Débito, Acreedora suma en Crédito). */
function efectoMovimiento(naturaleza: NaturalezaCuenta, debitoC: number, creditoC: number): number {
  return naturaleza === "DEUDORA" ? debitoC - creditoC : creditoC - debitoC;
}

export async function obtenerLibroMayor(prisma: PrismaClient, filtro: FiltroLibroMayor): Promise<LibroMayorCuenta> {
  const libro = filtro.libro ?? "COLEGIO";
  const mesDesde = filtro.mesDesde ?? 1;
  const mesHasta = filtro.mesHasta ?? 12;

  const cuenta = await prisma.catalogoCuenta.findUnique({ where: { libro_codigo: { libro, codigo: filtro.cuentaCodigo } } });
  if (!cuenta) throw new Error(`No existe la cuenta "${filtro.cuentaCodigo}" en el libro ${libro}.`);

  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio: filtro.anio } });

  // --- Saldo inicial del año (si existe) ---
  let saldoInicial = 0;
  if (anioLectivo) {
    const saldoInicialRow = await prisma.saldoInicial.findUnique({
      where: { colegioId_cuentaId_anioLectivoId: { colegioId: filtro.colegioId, cuentaId: cuenta.id, anioLectivoId: anioLectivo.id } },
    });
    if (saldoInicialRow) {
      saldoInicial += efectoMovimiento(cuenta.naturaleza, saldoInicialRow.debeInicial.toNumber(), saldoInicialRow.haberInicial.toNumber());
    }
  }

  // --- Arrastra los meses ANTERIORES al rango pedido (mismo año) hacia el saldo inicial ---
  if (mesDesde > 1) {
    const previos = await prisma.asientoContable.findMany({
      where: {
        cuentaId: cuenta.id,
        comprobante: { colegioId: filtro.colegioId, libro, anioLectivo: { anio: filtro.anio }, mes: { lt: mesDesde } },
      },
    });
    for (const p of previos) {
      saldoInicial += efectoMovimiento(cuenta.naturaleza, p.debitoC.toNumber(), p.creditoC.toNumber());
    }
  }

  // --- Movimientos del rango pedido ---
  const asientos = await prisma.asientoContable.findMany({
    where: {
      cuentaId: cuenta.id,
      comprobante: { colegioId: filtro.colegioId, libro, anioLectivo: { anio: filtro.anio }, mes: { gte: mesDesde, lte: mesHasta } },
    },
    include: { comprobante: true },
    orderBy: [{ comprobante: { fecha: "asc" } }, { comprobante: { numeroComprobante: "asc" } }, { numeroLinea: "asc" }],
  });

  let saldoCorriente = saldoInicial;
  let totalDebito = 0;
  let totalCredito = 0;
  const movimientos: MovimientoLibroMayor[] = asientos.map((a) => {
    const debitoC = a.debitoC.toNumber();
    const creditoC = a.creditoC.toNumber();
    totalDebito += debitoC;
    totalCredito += creditoC;
    saldoCorriente += efectoMovimiento(cuenta.naturaleza, debitoC, creditoC);
    return {
      fecha: a.comprobante.fecha,
      claveComprobante: a.comprobante.claveComprobante,
      concepto: a.comprobante.concepto,
      debitoC,
      creditoC,
      saldoAcumulado: Math.round((saldoCorriente + Number.EPSILON) * 100) / 100,
    };
  });

  return {
    cuentaId: cuenta.id,
    cuentaCodigo: cuenta.codigo,
    cuentaNombre: cuenta.nombre,
    naturaleza: cuenta.naturaleza,
    saldoInicial: Math.round((saldoInicial + Number.EPSILON) * 100) / 100,
    movimientos,
    totalDebito: Math.round((totalDebito + Number.EPSILON) * 100) / 100,
    totalCredito: Math.round((totalCredito + Number.EPSILON) * 100) / 100,
    saldoFinal: Math.round((saldoCorriente + Number.EPSILON) * 100) / 100,
  };
}
