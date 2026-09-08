/**
 * ============================================================================
 * MÓDULO LIBRO DIARIO (Jornalización)
 * ============================================================================
 * No es una tabla nueva -- es un REPORTE cronológico sobre `Comprobante` +
 * `AsientoContable`, que ya son la fuente de verdad de la partida doble
 * (los llenan `procesarPago`, `registrarPagoProveedor`, los importadores
 * históricos, etc.). Aquí solo se arma la vista: un renglón por comprobante,
 * con sus líneas de Débito/Crédito y el estado "OK - Cuadrado".
 */
import type { PrismaClient, LibroContable } from "@prisma/client";

export interface LineaLibroDiario {
  cuentaCodigo: string;
  cuentaNombre: string;
  movimiento: "DEBITO" | "CREDITO";
  debitoC: number;
  creditoC: number;
}

export interface AsientoLibroDiario {
  comprobanteId: bigint;
  claveComprobante: string;
  tipoComprobante: string;
  fecha: Date;
  mes: number;
  concepto: string | null;
  beneficiario: string | null;
  noDocumento: string | null;
  noCheque: string | null;
  origen: string;
  /** "OK - Cuadrado" si Débito=Crédito (siempre debería serlo -- ver `estado` de la tabla). */
  estadoTexto: string;
  estado: "CUADRADO" | "DESCUADRADO";
  totalDebito: number;
  totalCredito: number;
  lineas: LineaLibroDiario[];
}

export interface FiltroLibroDiario {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  anio: number;
  mes?: number; // 1-12, opcional -- si se omite trae el año completo
}

export async function obtenerLibroDiario(prisma: PrismaClient, filtro: FiltroLibroDiario): Promise<AsientoLibroDiario[]> {
  const libro = filtro.libro ?? "COLEGIO";
  const comprobantes = await prisma.comprobante.findMany({
    where: {
      colegioId: filtro.colegioId,
      libro,
      anioLectivo: { anio: filtro.anio },
      ...(filtro.mes ? { mes: filtro.mes } : {}),
    },
    orderBy: [{ fecha: "asc" }, { numeroComprobante: "asc" }],
    include: {
      beneficiario: true,
      asientos: { include: { cuenta: true }, orderBy: { numeroLinea: "asc" } },
    },
  });

  return comprobantes.map((c) => {
    const lineas: LineaLibroDiario[] = c.asientos.map((a) => ({
      cuentaCodigo: a.cuenta.codigo,
      cuentaNombre: a.cuenta.nombre,
      movimiento: a.movimiento,
      debitoC: a.debitoC.toNumber(),
      creditoC: a.creditoC.toNumber(),
    }));
    const totalDebito = lineas.reduce((s, l) => s + l.debitoC, 0);
    const totalCredito = lineas.reduce((s, l) => s + l.creditoC, 0);
    const cuadrado = Math.abs(totalDebito - totalCredito) <= 0.01 && c.estado === "CUADRADO";

    return {
      comprobanteId: c.id,
      claveComprobante: c.claveComprobante,
      tipoComprobante: c.tipoComprobante,
      fecha: c.fecha,
      mes: c.mes,
      concepto: c.concepto,
      beneficiario: c.beneficiario?.nombreCompleto ?? null,
      noDocumento: c.noDocumento,
      noCheque: c.noCheque,
      origen: c.origen,
      estadoTexto: cuadrado ? "OK - Cuadrado" : "⚠ DESCUADRADO - REVISAR",
      estado: cuadrado ? "CUADRADO" : "DESCUADRADO",
      totalDebito,
      totalCredito,
      lineas,
    };
  });
}
