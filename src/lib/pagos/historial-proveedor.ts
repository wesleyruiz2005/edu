/**
 * Punto 10 de la especificación: "mostrar el historial de pagos previos del
 * proveedor (cuentas usadas)" -- para que quien registra el pago vea/reuse
 * la cuenta correcta según el concepto, sin tener que adivinar cada vez.
 */
import type { PrismaClient } from "@prisma/client";

export interface CuentaFrecuenteProveedor {
  cuentaGastoId: number;
  codigo: string;
  nombre: string;
  vecesUsada: number;
  montoTotalHistorico: number;
  ultimaVezUsada: Date;
}

export interface PagoHistoricoProveedor {
  pagoId: bigint;
  fechaPago: Date;
  numeroComprobantePago: string;
  numeroFactura: string | null;
  conceptoPago: string;
  montoFactura: number;
  montoRetencion: number;
  montoNetoPagado: number;
  cuentas: { codigo: string; nombre: string; monto: number }[];
}

/**
 * Historial completo de pagos de un proveedor, más de una vez ordenado del
 * más reciente al más antiguo, y el ranking de cuentas de gasto que más ha
 * usado (para sugerirlas primero en el formulario de un pago nuevo).
 */
export async function obtenerHistorialProveedor(
  prisma: PrismaClient,
  proveedorId: number,
  opciones?: { limite?: number }
): Promise<{ pagos: PagoHistoricoProveedor[]; cuentasFrecuentes: CuentaFrecuenteProveedor[] }> {
  const pagos = await prisma.pagoProveedor.findMany({
    where: { proveedorId },
    orderBy: { fechaPago: "desc" },
    take: opciones?.limite ?? 25,
    include: { detalle: { include: { cuentaGasto: true } } },
  });

  const cuentasMap = new Map<number, CuentaFrecuenteProveedor>();
  for (const pago of pagos) {
    for (const d of pago.detalle) {
      const monto = d.monto.toNumber();
      const existente = cuentasMap.get(d.cuentaGastoId);
      if (existente) {
        existente.vecesUsada += 1;
        existente.montoTotalHistorico += monto;
        if (pago.fechaPago > existente.ultimaVezUsada) existente.ultimaVezUsada = pago.fechaPago;
      } else {
        cuentasMap.set(d.cuentaGastoId, {
          cuentaGastoId: d.cuentaGastoId,
          codigo: d.cuentaGasto.codigo,
          nombre: d.cuentaGasto.nombre,
          vecesUsada: 1,
          montoTotalHistorico: monto,
          ultimaVezUsada: pago.fechaPago,
        });
      }
    }
  }

  const cuentasFrecuentes = Array.from(cuentasMap.values()).sort((a, b) => b.vecesUsada - a.vecesUsada);

  const pagosFormateados: PagoHistoricoProveedor[] = pagos.map((p) => ({
    pagoId: p.id,
    fechaPago: p.fechaPago,
    numeroComprobantePago: p.numeroComprobantePago,
    numeroFactura: p.numeroFactura,
    conceptoPago: p.conceptoPago,
    montoFactura: p.montoFactura.toNumber(),
    montoRetencion: p.montoRetencion.toNumber(),
    montoNetoPagado: p.montoNetoPagado.toNumber(),
    cuentas: p.detalle.map((d) => ({ codigo: d.cuentaGasto.codigo, nombre: d.cuentaGasto.nombre, monto: d.monto.toNumber() })),
  }));

  return { pagos: pagosFormateados, cuentasFrecuentes };
}
