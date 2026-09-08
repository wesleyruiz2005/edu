/**
 * ============================================================================
 * Reglas de negocio "puras" del Módulo de Facturación y Aranceles.
 * ============================================================================
 *
 * Este archivo NO se conecta a la base de datos — son solo fórmulas, igual
 * que una celda de Excel. Por eso se pueden probar directamente (ver
 * `scripts/probar-reglas.ts`) sin necesitar Prisma ni una base de datos real.
 *
 * Aquí viven las 3 reglas que Eduardo pidió automatizar:
 *   1) calcularMontoFacturado  -> aplica la beca (si tiene) sobre la tarifa base.
 *   2) calcularFechaVencimiento -> día límite de pago de un cargo (día 5 por defecto).
 *   3) evaluarMora             -> decide si corresponde el recargo del 10% y lo calcula.
 */

// ----------------------------------------------------------------------------
// Becas y descuentos
// ----------------------------------------------------------------------------

export type TipoCalculoBeca = "PORCENTAJE" | "MONTO_FIJO";

/** Espejo simplificado del modelo `TipoBeca` de schema.prisma. */
export interface BecaAplicable {
  /** "PORCENTAJE" = valor es un % de descuento (ej. 50 = Media Beca). */
  tipoCalculo: TipoCalculoBeca;
  /** Si es PORCENTAJE: 0-100. Si es MONTO_FIJO: descuento en córdobas. */
  valor: number;
  /** id del concepto al que aplica esta beca, o null = aplica a cualquier
   *  concepto marcado como recurrente mensual (típicamente Mensualidad). */
  aplicaAConceptoId: number | null;
}

/** Espejo simplificado del modelo `ConceptoArancel`. */
export interface ConceptoParaCobro {
  id: number;
  esRecurrenteMensual: boolean;
}

/**
 * Redondea a 2 decimales (córdobas con centavos) evitando errores de
 * punto flotante (ej. 0.1 + 0.2 en JavaScript).
 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * ¿La beca recibida aplica al concepto que se está cobrando?
 * - Si `aplicaAConceptoId` es null, la beca es "general": aplica a
 *   cualquier concepto recurrente mensual (Mensualidad, típicamente).
 * - Si trae un id, solo aplica exactamente a ese concepto (ej. una beca
 *   que exonera SOLO Papelería, dejando Matrícula y Mensualidad intactas).
 */
export function becaAplicaAConcepto(
  beca: BecaAplicable,
  concepto: ConceptoParaCobro
): boolean {
  if (beca.aplicaAConceptoId === null) return concepto.esRecurrenteMensual;
  return beca.aplicaAConceptoId === concepto.id;
}

/**
 * Calcula el monto que realmente se factura a un estudiante para un
 * concepto dado, aplicando su beca vigente (si tiene una que corresponda).
 *
 * Ejemplo real del Excel: tarifa base de Mensualidad = C$650. Un alumno con
 * "Media Beca" (PORCENTAJE, valor 50) paga C$325 — exactamente como en la
 * hoja "Facturación" del Colegio El Mesías.
 */
export function calcularMontoFacturado(
  montoBase: number,
  concepto: ConceptoParaCobro,
  beca: BecaAplicable | null
): number {
  if (!beca || !becaAplicaAConcepto(beca, concepto)) {
    return round2(montoBase);
  }
  if (beca.tipoCalculo === "PORCENTAJE") {
    return round2(montoBase * (1 - beca.valor / 100));
  }
  // MONTO_FIJO = descuento fijo en córdobas (nunca deja el cargo en negativo).
  return round2(Math.max(0, montoBase - beca.valor));
}

// ----------------------------------------------------------------------------
// Recargo por mora
// ----------------------------------------------------------------------------

/** Espejo simplificado del modelo `ReglaMora`. */
export interface ReglaMoraAplicable {
  /** Día del mes hasta el cual se puede pagar sin recargo (5 por defecto). */
  diaLimitePago: number;
  /** Porcentaje de recargo, ej. 10.00 = 10%. */
  porcentajeRecargo: number;
}

export interface ResultadoMora {
  aplicaMora: boolean;
  fechaVencimiento: Date;
  recargoMonto: number;
  recargoPctAplicado: number | null;
}

/**
 * Calcula la fecha límite de pago de un cargo mensual: el día
 * `diaLimitePago` (5 por defecto) del mes que se está cobrando.
 *
 * Ejemplo: mes=1 (Enero), año=2026, día límite=5 -> 5 de enero de 2026.
 * Después de esa fecha, si el cargo sigue sin pagarse, aplica el recargo.
 */
export function calcularFechaVencimiento(
  anio: number,
  mes: number,
  diaLimitePago: number
): Date {
  // Usamos UTC para no depender de la zona horaria del servidor.
  return new Date(Date.UTC(anio, mes - 1, diaLimitePago));
}

/**
 * Decide si corresponde aplicar el recargo por mora y, si corresponde,
 * calcula el monto exacto.
 *
 * Reglas (tal como se aplican hoy manualmente en el Excel, ej. las notas
 * "APLICADA MORA 10%" en Detalle de Caja):
 *   - Solo se evalúa si el cargo todavía tiene saldo pendiente > 0.
 *   - Solo se evalúa si ya pasó la fecha de vencimiento (día 5).
 *   - El recargo se calcula UNA sola vez por cargo (no se vuelve a aplicar
 *     mes tras mes sobre el mismo cargo si ya se le había aplicado antes).
 *   - El recargo es el % vigente sobre el monto ORIGINALMENTE facturado
 *     (no sobre el saldo, para no cobrar "mora sobre mora").
 */
export function evaluarMora(
  montoFacturado: number,
  saldoPendienteActual: number,
  fechaVencimiento: Date,
  fechaEvaluacion: Date,
  regla: ReglaMoraAplicable,
  yaTieneMoraAplicada: boolean
): ResultadoMora {
  const yaVencio = fechaEvaluacion.getTime() > fechaVencimiento.getTime();
  const tieneSaldo = saldoPendienteActual > 0;

  if (!yaVencio || !tieneSaldo || yaTieneMoraAplicada) {
    return {
      aplicaMora: false,
      fechaVencimiento,
      recargoMonto: 0,
      recargoPctAplicado: null,
    };
  }

  const recargoMonto = round2(montoFacturado * (regla.porcentajeRecargo / 100));
  return {
    aplicaMora: true,
    fechaVencimiento,
    recargoMonto,
    recargoPctAplicado: regla.porcentajeRecargo,
  };
}
