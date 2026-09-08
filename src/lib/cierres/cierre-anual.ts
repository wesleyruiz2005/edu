/**
 * ============================================================================
 * MÓDULO DE CIERRE ANUAL (automático)
 * ============================================================================
 * Requiere los 12 `CierreContable` del año ya CERRADOS. Genera el asiento de
 * cierre que cancela las cuentas de Ingreso/Costo/Gasto contra "34 Excedente
 * Del Ejercicio" (Patrimonio) -- la utilidad o pérdida del año queda
 * reflejada ahí, lista para que el siguiente año lectivo arranque con
 * saldos_iniciales limpios en las cuentas de resultado.
 *
 * Partida doble del asiento de cierre (siempre cuadra por construcción):
 *   Débito  cada cuenta de INGRESO por su saldo (para dejarla en cero)
 *   Crédito cada cuenta de COSTO/GASTO por su saldo (para dejarla en cero)
 *   Balancea contra "34 Excedente Del Ejercicio": crédito si hubo utilidad,
 *   débito si hubo pérdida.
 */
import type { PrismaClient, LibroContable } from "@prisma/client";
import { obtenerCuenta } from "../caja/comprobante-utils";
import { crearComprobanteBalanceado, agruparPorCuenta } from "../caja/procesar-pago";
import { obtenerBalanzaComprobacion } from "../reportes/balanza-comprobacion";
import { obtenerEstadoResultados } from "../reportes/estado-resultados";
import { obtenerBalanceGeneral } from "../reportes/balance-general";

const CUENTA_EXCEDENTE_DEL_EJERCICIO = "34"; // "Excedente Del Ejercicio" (Patrimonio) -- equivalente a "Utilidad del Ejercicio"

export interface ParametrosCierreAnual {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  anio: number;
  cerradoPor?: string;
  /** Código de la cuenta de patrimonio contra la que se cierra el resultado del año. Por defecto "34" Excedente Del Ejercicio. */
  cuentaResultadoCodigo?: string;
}

export interface ResultadoCierreAnual {
  cierreAnualId: number;
  anio: number;
  utilidadEjercicio: number;
  comprobanteId: bigint | null;
  claveComprobante: string | null;
}

export async function cerrarAnio(prisma: PrismaClient, params: ParametrosCierreAnual): Promise<ResultadoCierreAnual> {
  const libro = params.libro ?? "COLEGIO";

  const existente = await prisma.cierreAnual.findUnique({
    where: { colegioId_libro_anio: { colegioId: params.colegioId, libro, anio: params.anio } },
  });
  if (existente?.estado === "CERRADO") {
    throw new Error(`El año ${params.anio} (libro ${libro}) ya está cerrado desde ${existente.fechaCierre?.toISOString().slice(0, 10)}.`);
  }

  // --- Requisito: los 12 meses deben estar CERRADOS ---
  const cierresMensuales = await prisma.cierreContable.findMany({
    where: { colegioId: params.colegioId, libro, anio: params.anio },
  });
  const mesesCerrados = new Set(cierresMensuales.filter((c) => c.estado === "CERRADO").map((c) => c.mes));
  const mesesFaltantes = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => !mesesCerrados.has(m));
  if (mesesFaltantes.length > 0) {
    throw new Error(
      `No se puede cerrar el año ${params.anio}: faltan por cerrar los meses ${mesesFaltantes.join(", ")}. Cierra cada mes primero con cerrarMes().`
    );
  }

  const filtroReporte = { colegioId: params.colegioId, libro, anio: params.anio, mesHasta: 12 };
  const [balanza, estadoResultados, balanceGeneral] = await Promise.all([
    obtenerBalanzaComprobacion(prisma, filtroReporte),
    obtenerEstadoResultados(prisma, filtroReporte),
    obtenerBalanceGeneral(prisma, filtroReporte),
  ]);

  const utilidadNeta = estadoResultados.utilidadNeta;

  const resultado = await prisma.$transaction(async (tx) => {
    let comprobanteId: bigint | null = null;
    let claveComprobante: string | null = null;

    // Solo genera el asiento de cierre si hay algo que cerrar (evita un
    // comprobante vacío en libros sin actividad de resultado ese año).
    const renglonesResultado = balanza.renglones.filter((r) => r.clase === "INGRESO" || r.clase === "COSTO" || r.clase === "GASTO");
    if (renglonesResultado.length > 0) {
      const cuentaResultado = await obtenerCuenta(tx, libro, params.cuentaResultadoCodigo ?? CUENTA_EXCEDENTE_DEL_EJERCICIO);

      const debitos = balanza.renglones
        .filter((r) => r.clase === "INGRESO" && r.saldoFinal !== 0)
        .map((r) => ({ cuentaId: r.cuentaId, monto: r.saldoFinal }));
      const creditos = balanza.renglones
        .filter((r) => (r.clase === "COSTO" || r.clase === "GASTO") && r.saldoFinal !== 0)
        .map((r) => ({ cuentaId: r.cuentaId, monto: r.saldoFinal }));

      if (utilidadNeta >= 0) {
        creditos.push({ cuentaId: cuentaResultado.id, monto: Math.round((utilidadNeta + Number.EPSILON) * 100) / 100 });
      } else {
        debitos.push({ cuentaId: cuentaResultado.id, monto: Math.round((-utilidadNeta + Number.EPSILON) * 100) / 100 });
      }

      const comprobante = await crearComprobanteBalanceado(tx, {
        colegioId: params.colegioId,
        libro,
        tipoComprobante: "CIERRE",
        origen: "AUTO_CIERRE",
        fecha: new Date(Date.UTC(params.anio, 11, 31)),
        concepto: `Cierre anual ${params.anio} -- cancela Ingresos/Costos/Gastos contra ${cuentaResultado.codigo} ${cuentaResultado.nombre}.`,
        debitos: agruparPorCuenta(debitos),
        creditos: agruparPorCuenta(creditos),
      });
      comprobanteId = comprobante.comprobanteId;
      claveComprobante = comprobante.claveComprobante;
    }

    const cierreAnual = await tx.cierreAnual.upsert({
      where: { colegioId_libro_anio: { colegioId: params.colegioId, libro, anio: params.anio } },
      create: {
        colegioId: params.colegioId,
        libro,
        anio: params.anio,
        estado: "CERRADO",
        fechaCierre: new Date(),
        utilidadEjercicio: utilidadNeta,
        comprobanteCierreId: comprobanteId,
        estadoResultadosJson: estadoResultados as object,
        balanceGeneralJson: balanceGeneral as object,
      },
      update: {
        estado: "CERRADO",
        fechaCierre: new Date(),
        utilidadEjercicio: utilidadNeta,
        comprobanteCierreId: comprobanteId,
        estadoResultadosJson: estadoResultados as object,
        balanceGeneralJson: balanceGeneral as object,
      },
    });

    // Abre el siguiente año lectivo si todavía no existe (para que el
    // sistema tenga dónde seguir jornalizando el 1 de enero siguiente).
    const anioSiguiente = params.anio + 1;
    await tx.anioLectivo.upsert({
      where: { anio: anioSiguiente },
      create: { anio: anioSiguiente },
      update: {},
    });

    return { cierreAnualId: cierreAnual.id, comprobanteId, claveComprobante };
  });

  return {
    cierreAnualId: resultado.cierreAnualId,
    anio: params.anio,
    utilidadEjercicio: utilidadNeta,
    comprobanteId: resultado.comprobanteId,
    claveComprobante: resultado.claveComprobante,
  };
}
