/**
 * ============================================================================
 * TASAS OFICIALES DE NÓMINA -- confirmadas 7 sept 2026
 * ============================================================================
 * Confirmadas de DOS formas: (1) contra los 3 Excel reales de nómina que
 * Eduardo subió (El Mesías personal fijo, Instituto personal fijo, Instituto
 * "Pago por Servicios" -- ver las fórmulas de las columnas AE-AH de cada
 * hoja mensual, ej. "AGOST 2026"), y (2) contra fuentes públicas actuales de
 * legislación laboral nicaragüense 2026 (búsqueda web, 7 sept 2026) para la
 * tabla de IR, que ninguno de los 3 Excel usa todavía.
 *
 * Si la DGI actualiza la tabla de IR o cambian las tasas de INSS/INATEC más
 * adelante, este es el ÚNICO archivo que hay que tocar.
 */

/** INSS Laboral (retenido al empleado). Confirmado exacto en los 3 Excel reales: fórmula "=(Total Ingresos - Viáticos)*7%". */
export const TASA_INSS_LABORAL = 0.07;

/** INSS Patronal para empleadores con MENOS de 50 trabajadores. Confirmado exacto en los 2 Excel de personal fijo: "CUOTA PATRONAL POR PAGAR (21.5%)". */
export const TASA_INSS_PATRONAL_MENOS_DE_50 = 0.215;

/** INSS Patronal para empleadores con 50 o más trabajadores (fuente pública, legislación vigente 2026) -- Eduardo mencionó esta cifra de memoria; ninguno de los 3 colegios llega hoy a 50 empleados. */
export const TASA_INSS_PATRONAL_50_O_MAS = 0.225;

/** INATEC patronal (Ley). Los 3 Excel reales lo traen en CERO -- se deja APAGADO por defecto hasta confirmar con Eduardo si el colegio está exonerado. */
export const TASA_INATEC_PATRONAL = 0.02;

/** Retención de Servicio Profesional (docente por hora, Instituto) -- confirmada exacta contra el Excel real. */
export const TASA_RETENCION_SERVICIO_PROFESIONAL = 0.1;

/** Retención de Servicio General (contrato, Instituto) -- confirmada exacta contra el Excel real. */
export const TASA_RETENCION_SERVICIO_GENERAL = 0.02;

/**
 * "Piso de cotización" mensual del sector Docencia -- confirmado exacto (7
 * sept 2026) contra la hoja "Decla. Inss [Mes]" de El Buen Pastor: los 8
 * empleados inscritos al INSS, en los 3 meses reales (enero-marzo 2026),
 * cotizan sobre este monto cuando su salario real es MENOR (24/24 casos
 * exactos). Cuando el salario real ya supera el piso (ej. la Directora
 * General con C$14,416), se cotiza sobre el salario real, sin tope.
 *
 * Importante: el Excel real SÍ le deduce al empleado solo el 7% de su
 * SALARIO REAL (columna "INSS LABORAL" de la planilla quincenal) -- pero
 * DECLARA y PAGA al INSS el 7%/21.5% sobre este piso. La diferencia la
 * asume El Buen Pastor como gasto patronal adicional (ver
 * `calcularInssConPisoCotizacion`). Ninguno de los otros 2 colegios (El
 * Mesías / Instituto) usa este piso -- ahí se cotiza siempre sobre el
 * salario real, sin mínimo.
 */
export const PISO_COTIZACION_DOCENCIA_MENSUAL = 8341.29;

/** Tabla progresiva del IR anual (Ley 822, confirmada vigente para 2026 contra fuentes públicas el 7 sept 2026). */
export const TABLA_IR_ANUAL: { desde: number; hasta: number; tasa: number; base: number }[] = [
  { desde: 0, hasta: 100_000, tasa: 0, base: 0 },
  { desde: 100_000, hasta: 200_000, tasa: 0.15, base: 0 },
  { desde: 200_000, hasta: 350_000, tasa: 0.2, base: 15_000 },
  { desde: 350_000, hasta: 500_000, tasa: 0.25, base: 45_000 },
  { desde: 500_000, hasta: Infinity, tasa: 0.3, base: 82_500 },
];

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** = (Total Ingresos - Viáticos de Transporte) * 7%. */
export function calcularInssLaboral(totalIngresos: number, viaticosTransporte = 0): number {
  return redondear(Math.max(0, totalIngresos - viaticosTransporte) * TASA_INSS_LABORAL);
}

/** = Salario Cotizado * 21.5% (o 22.5% si el colegio ya tiene 50+ trabajadores). GASTO patronal -- no se le resta al empleado. */
export function calcularInssPatronal(salarioCotizado: number, empleadosDelColegio50OMas = false): number {
  const tasa = empleadosDelColegio50OMas ? TASA_INSS_PATRONAL_50_O_MAS : TASA_INSS_PATRONAL_MENOS_DE_50;
  return redondear(salarioCotizado * tasa);
}

/** = Salario Cotizado * 2%. GASTO patronal -- no se le resta al empleado. Apagado por defecto (ver `TASA_INATEC_PATRONAL`). */
export function calcularInatecPatronal(salarioCotizado: number): number {
  return redondear(salarioCotizado * TASA_INATEC_PATRONAL);
}

/** IR anual según la tabla progresiva: `base` del tramo + (exceso sobre el límite inferior del tramo) * tasa del tramo. */
export function calcularIrAnual(baseAnualGravable: number): number {
  if (baseAnualGravable <= 0) return 0;
  const tramo =
    TABLA_IR_ANUAL.find((t) => baseAnualGravable > t.desde && baseAnualGravable <= t.hasta) ?? TABLA_IR_ANUAL[TABLA_IR_ANUAL.length - 1];
  return redondear(tramo.base + (baseAnualGravable - tramo.desde) * tramo.tasa);
}

/**
 * IR mensual: proyecta el salario del mes (ya neto de INSS laboral) a un
 * año completo, calcula el IR anual por la tabla progresiva, y lo divide
 * entre 12. Es el método simplificado más comúnmente documentado para la
 * retención mensual en Nicaragua; no incorpora variaciones de salario mes a
 * mes durante el año (aguinaldo, bonos puntuales) -- para eso se necesitaría
 * una proyección con el historial real de pagos del año, que se puede
 * agregar más adelante si Eduardo lo pide.
 */
export function calcularIrMensual(salarioMensualBruto: number, inssLaboralMensual: number): number {
  const baseMensualGravable = Math.max(0, salarioMensualBruto - inssLaboralMensual);
  const baseAnual = redondear(baseMensualGravable * 12);
  const irAnual = calcularIrAnual(baseAnual);
  return redondear(irAnual / 12);
}

export interface ResultadoInssConPiso {
  /** El mayor entre el salario real y el piso -- es sobre esto que se calcula lo que hay que PAGAR al INSS. */
  salarioBaseCotizable: number;
  /** Lo que realmente se le resta al empleado en su cheque (7% de su salario REAL, nunca del piso). */
  inssLaboralDeducidoAlEmpleado: number;
  /** Lo que el colegio debe DECLARAR y PAGAR al INSS por la cuota laboral (7% del piso, si el real no lo alcanza). */
  inssLaboralPorPagarAlInss: number;
  /** Cuota patronal (21.5%/22.5%) sobre el piso -- 100% gasto del colegio, como siempre. */
  inssPatronalPorPagar: number;
  /** = inssLaboralPorPagarAlInss - inssLaboralDeducidoAlEmpleado. La brecha que el colegio asume de su bolsillo para completar la cotización mínima del empleado (nunca negativo). */
  subsidioInssAsumidoPorElColegio: number;
}

/**
 * Calcula INSS Laboral/Patronal aplicando un "piso de cotización" mensual
 * (ver `PISO_COTIZACION_DOCENCIA_MENSUAL`) -- el esquema real de El Buen
 * Pastor para su personal inscrito al INSS. Para colegios sin piso (El
 * Mesías / Instituto), no se usa esta función -- ahí `calcularInssLaboral`/
 * `calcularInssPatronal` ya cotizan sobre el salario real directamente.
 */
export function calcularInssConPisoCotizacion(
  salarioMensualReal: number,
  piso: number = PISO_COTIZACION_DOCENCIA_MENSUAL,
  empleadosDelColegio50OMas = false
): ResultadoInssConPiso {
  const salarioBaseCotizable = Math.max(salarioMensualReal, piso);
  const inssLaboralDeducidoAlEmpleado = calcularInssLaboral(salarioMensualReal);
  const inssLaboralPorPagarAlInss = calcularInssLaboral(salarioBaseCotizable);
  const inssPatronalPorPagar = calcularInssPatronal(salarioBaseCotizable, empleadosDelColegio50OMas);
  const subsidioInssAsumidoPorElColegio = Math.max(0, redondear(inssLaboralPorPagarAlInss - inssLaboralDeducidoAlEmpleado));
  return { salarioBaseCotizable, inssLaboralDeducidoAlEmpleado, inssLaboralPorPagarAlInss, inssPatronalPorPagar, subsidioInssAsumidoPorElColegio };
}
