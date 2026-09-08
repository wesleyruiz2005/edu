/**
 * ============================================================================
 * REGULARIZACIÓN DE ANTICIPOS -- proceso masivo del 01 de enero
 * ============================================================================
 * Cuando un año lectivo nuevo empieza, todo lo que se había cobrado como
 * "anticipo" para ESE año (contabilizado contra el pasivo 2110 -- ver
 * `procesarPago`) debe trasladarse al ingreso real, porque el año por el
 * que se cobró ya llegó.
 *
 * Por cada colegio con anticipos pendientes de regularizar para el año que
 * empieza, se genera UN comprobante:
 *   Débito  2110 - Ingresos Recibidos por Anticipado   (por el total)
 *   Crédito la(s) cuenta(s) de ingreso real que corresponda(n)
 *           (Matrícula, Papelería, Décimo Tercer Mes... agrupadas)
 *
 * Cada `recibo_detalle` que se incluyó se marca `regularizado = true`, para
 * que este proceso se pueda correr de más sin riesgo de duplicar el
 * traslado (es idempotente).
 */
import type { PrismaClient } from "@prisma/client";
import { obtenerCuenta } from "../caja/comprobante-utils";
import { siguienteNumeroComprobante } from "../caja/comprobante-utils";

const CUENTA_ANTICIPOS = "2110";

export interface ResumenRegularizacion {
  colegioId: number;
  comprobanteId: bigint | null;
  claveComprobante: string | null;
  totalRegularizado: number;
  reciboDetallesIncluidos: number;
}

export async function regularizarAnticiposDelAnio(
  prisma: PrismaClient,
  params: { anioLectivoQueEmpieza: number; fecha?: Date }
): Promise<ResumenRegularizacion[]> {
  const fecha = params.fecha ?? new Date(Date.UTC(params.anioLectivoQueEmpieza, 0, 1));
  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio: params.anioLectivoQueEmpieza } });
  if (!anioLectivo) {
    throw new Error(`No existe el año lectivo ${params.anioLectivoQueEmpieza}.`);
  }

  // Todos los anticipos sin regularizar cuyo cargo destino ya es este año.
  const pendientes = await prisma.reciboDetalle.findMany({
    where: {
      esAnticipo: true,
      regularizado: false,
      cargoEstudiante: { anioLectivoId: anioLectivo.id },
    },
    include: {
      cargoEstudiante: { include: { concepto: true } },
      recibo: { select: { colegioId: true } },
    },
  });

  const porColegio = new Map<number, typeof pendientes>();
  for (const p of pendientes) {
    const lista = porColegio.get(p.recibo.colegioId) ?? [];
    lista.push(p);
    porColegio.set(p.recibo.colegioId, lista);
  }

  const resultados: ResumenRegularizacion[] = [];

  for (const [colegioId, detalles] of porColegio) {
    const resultado = await prisma.$transaction(async (tx) => {
      const cuentaAnticipos = await obtenerCuenta(tx, "COLEGIO", CUENTA_ANTICIPOS);

      const porCuentaIngreso = new Map<number, number>();
      let total = 0;
      for (const d of detalles) {
        const cuentaIngresoId = d.cargoEstudiante!.concepto.cuentaContableId;
        const monto = d.montoPagado.toNumber();
        porCuentaIngreso.set(cuentaIngresoId, (porCuentaIngreso.get(cuentaIngresoId) ?? 0) + monto);
        total += monto;
      }
      total = Math.round((total + Number.EPSILON) * 100) / 100;

      const numeroComprobante = await siguienteNumeroComprobante(tx, {
        colegioId,
        libro: "COLEGIO",
        tipoComprobante: "CIERRE",
      });
      const claveComprobante = `CIERRE-${numeroComprobante}`;

      const comprobante = await tx.comprobante.create({
        data: {
          colegioId,
          libro: "COLEGIO",
          tipoComprobante: "CIERRE",
          numeroComprobante,
          claveComprobante,
          fecha,
          concepto: `Regularización de anticipos de matrícula/papelería del año lectivo ${anioLectivo.anio} (${detalles.length} recibo(s))`,
          anioLectivoId: anioLectivo.id,
          mes: 1,
          origen: "AUTO_REGULARIZACION_ANTICIPO",
          estado: "CUADRADO",
        },
      });

      let numeroLinea = 1;
      await tx.asientoContable.create({
        data: {
          comprobanteId: comprobante.id,
          numeroLinea: numeroLinea++,
          cuentaId: cuentaAnticipos.id,
          movimiento: "DEBITO",
          moneda: "NIO",
          montoMonedaOrigen: total,
          debitoC: total,
          creditoC: 0,
        },
      });
      for (const [cuentaIngresoId, monto] of porCuentaIngreso) {
        await tx.asientoContable.create({
          data: {
            comprobanteId: comprobante.id,
            numeroLinea: numeroLinea++,
            cuentaId: cuentaIngresoId,
            movimiento: "CREDITO",
            moneda: "NIO",
            montoMonedaOrigen: monto,
            debitoC: 0,
            creditoC: monto,
          },
        });
      }

      await tx.reciboDetalle.updateMany({
        where: { id: { in: detalles.map((d) => d.id) } },
        data: { regularizado: true },
      });

      return { comprobanteId: comprobante.id, claveComprobante, total };
    });

    resultados.push({
      colegioId,
      comprobanteId: resultado.comprobanteId,
      claveComprobante: resultado.claveComprobante,
      totalRegularizado: resultado.total,
      reciboDetallesIncluidos: detalles.length,
    });
  }

  return resultados;
}
