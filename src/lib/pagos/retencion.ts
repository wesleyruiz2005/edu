/**
 * ============================================================================
 * REGLA DE RETENCIÓN -- Módulo de Pago a Proveedores (punto 7)
 * ============================================================================
 * Regla que Eduardo dio el 7 sept 2026, tal cual:
 *
 *   - Compra o servicio general: si la factura es MAYOR a C$1,000, se retiene
 *     el 2%, calculado ANTES de IVA.
 *   - Servicio profesional: se retiene el 10% sobre el monto TOTAL del
 *     servicio (sin distinguir IVA en este esquema -- Eduardo indicó que los
 *     servicios profesionales no llevan IVA en este contexto).
 *   - Proveedores con una "constancia de no retención" VIGENTE quedan
 *     exonerados de TODA retención (ni el 2% ni el 10% se les aplica).
 *
 * Esta función es pura (no toca la base de datos) para que sea fácil de
 * probar; `registrarPagoProveedor()` es quien la llama dentro de la
 * transacción y decide con qué proveedor/fecha evaluar la exoneración.
 */

export const PORCENTAJE_RETENCION_COMPRA_O_SERVICIO_GENERAL = 2;
export const PORCENTAJE_RETENCION_SERVICIO_PROFESIONAL = 10;
/** Umbral en córdobas: por debajo o igual a este monto NO aplica el 2%. */
export const UMBRAL_RETENCION_COMPRA_O_SERVICIO_GENERAL = 1000;

export type TipoGastoRetencion = "COMPRA_O_SERVICIO_GENERAL" | "SERVICIO_PROFESIONAL";

export interface ParametrosRetencion {
  tipoGasto: TipoGastoRetencion;
  /** Monto total de la factura (con IVA incluido, si lo hay). */
  montoFactura: number;
  /** Solo para COMPRA_O_SERVICIO_GENERAL: monto antes de IVA. Si no se da, se usa `montoFactura` completo. */
  baseImponibleSinIva?: number | null;
  /** true si el proveedor tiene constancia de no retención vigente en la fecha del pago. */
  proveedorExonerado: boolean;
}

export interface ResultadoRetencion {
  porcentaje: number;
  /** Monto sobre el que se aplicó el porcentaje. */
  base: number;
  monto: number;
  /** Explica por qué se aplicó o no se aplicó retención (para mostrar en pantalla / dejar constancia). */
  motivo: string;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calcularRetencion(params: ParametrosRetencion): ResultadoRetencion {
  if (params.proveedorExonerado) {
    return { porcentaje: 0, base: 0, monto: 0, motivo: "Proveedor con constancia de no retención vigente -- exonerado." };
  }

  if (params.tipoGasto === "SERVICIO_PROFESIONAL") {
    const monto = redondear(params.montoFactura * (PORCENTAJE_RETENCION_SERVICIO_PROFESIONAL / 100));
    return {
      porcentaje: PORCENTAJE_RETENCION_SERVICIO_PROFESIONAL,
      base: params.montoFactura,
      monto,
      motivo: "Servicio profesional -- 10% sobre el monto total del servicio.",
    };
  }

  // COMPRA_O_SERVICIO_GENERAL
  if (params.montoFactura <= UMBRAL_RETENCION_COMPRA_O_SERVICIO_GENERAL) {
    return {
      porcentaje: 0,
      base: 0,
      monto: 0,
      motivo: `Factura de C$${params.montoFactura.toFixed(2)} -- no supera el umbral de C$${UMBRAL_RETENCION_COMPRA_O_SERVICIO_GENERAL.toFixed(2)}, no aplica retención.`,
    };
  }
  const base = params.baseImponibleSinIva ?? params.montoFactura;
  const monto = redondear(base * (PORCENTAJE_RETENCION_COMPRA_O_SERVICIO_GENERAL / 100));
  return {
    porcentaje: PORCENTAJE_RETENCION_COMPRA_O_SERVICIO_GENERAL,
    base,
    monto,
    motivo: `Compra o servicio general por más de C$${UMBRAL_RETENCION_COMPRA_O_SERVICIO_GENERAL.toFixed(2)} -- 2% calculado antes de IVA.`,
  };
}

/** true si, a la fecha del pago, el proveedor tiene una constancia de no retención vigente. */
export function proveedorEstaExonerado(
  proveedor: { tieneConstanciaNoRetencion: boolean; constanciaVigenciaHasta: Date | null },
  fechaPago: Date
): boolean {
  if (!proveedor.tieneConstanciaNoRetencion) return false;
  if (!proveedor.constanciaVigenciaHasta) return true; // sin fecha registrada = se asume vigente (avisar a Eduardo)
  return proveedor.constanciaVigenciaHasta.getTime() >= fechaPago.getTime();
}
