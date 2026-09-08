/**
 * ============================================================================
 * PRUEBA DE VERIFICACIÓN -- Nóminas reales de El Buen Pastor vs. fórmulas
 * ============================================================================
 * Igual que `probar-nominas-reales.ts` (Mesías/Instituto), pero para los 2
 * archivos de El Buen Pastor que Eduardo subió después (personal inscrito al
 * INSS con "piso de cotización" + personal No-INSS quincenal).
 *
 * Verifica 3 hipótesis, las 3 confirmadas exactas (0 diferencias) contra los
 * datos reales extraídos con Python de las hojas "1RA/2DA QUINC. [MES] 2026"
 * y "Decla. Inss [Mes] 2026" de ambos archivos:
 *
 *   1. Personal No-INSS: INSS Laboral = C$0 SIEMPRE (48/48 quincenas).
 *   2. Personal INSS: INSS Laboral REAL deducido al empleado = 0% en la 1ra
 *      quincena y 14% de la quincena en la 2da quincena (= 7% del salario
 *      mensual completo, ya que quincena×2 = mensual).
 *   3. Personal INSS: lo que el colegio DECLARA y PAGA al INSS (7%/21.5%) se
 *      calcula sobre el "piso de cotización" (C$8,341.29/mes) cuando el
 *      salario real del empleado no lo alcanza -- 24/24 declaraciones reales.
 *
 * Ejecutar con:
 *   node --experimental-strip-types scripts/probar-nominas-buen-pastor-reales.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { calcularInssLaboral, calcularInssConPisoCotizacion, PISO_COTIZACION_DOCENCIA_MENSUAL } from "../src/lib/nomina/inss-ir.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QuincenaNoInss {
  quincena: string;
  nombre: string;
  salarioQuincenal: number;
  totalIngresos: number;
  inssLaboralReal: number;
  totalDeducciones: number;
  netoReal: number;
}

interface QuincenaInss {
  quincena: string;
  esSegundaQuincena: boolean;
  nombre: string;
  salarioQuincenal: number;
  totalIngresos: number;
  inssLaboralReal: number;
  netoReal: number;
}

interface DeclaracionInss {
  mes: string;
  nombre: string;
  salarioMensual: number;
  totalIngresos: number;
  inssLaboralDeducido: number;
  salarioRealAReportar: number;
  inssLaboral7PorPagar: number;
  inssPatronal21_5PorPagar: number;
}

let raw: string;
try {
  raw = readFileSync(join(__dirname, "buen-pastor-reales-extraidas.json"), "utf-8");
} catch {
  raw = readFileSync(
    "/tmp/claude-0/-home-claude/08af915d-d96e-5f8d-8689-3d414da41b98/scratchpad/bp_verify/buen_pastor_reales.json",
    "utf-8"
  );
}
const data: { no_inss_quincenas: QuincenaNoInss[]; inss_quincenas: QuincenaInss[]; inss_declaraciones: DeclaracionInss[] } = JSON.parse(raw);

const TOLERANCIA = 0.05; // 5 centavos (los datos reales traen redondeos en cascada del Excel)

let ok = 0;
let fallos = 0;
const fallosDetalle: string[] = [];

function comparar(etiqueta: string, calculado: number, real: number) {
  const diff = Math.round(Math.abs(calculado - real) * 100) / 100;
  if (diff <= TOLERANCIA) {
    ok++;
  } else {
    fallos++;
    fallosDetalle.push(`  ✗ ${etiqueta}: calculado C$${calculado.toFixed(2)} vs real C$${real.toFixed(2)} (dif C$${diff.toFixed(2)})`);
  }
}

console.log("=".repeat(78));
console.log("VERIFICACIÓN 1/3 -- Personal No-INSS (El Buen Pastor): INSS Laboral = C$0 siempre");
console.log("=".repeat(78));
for (const r of data.no_inss_quincenas) {
  comparar(`${r.quincena} | ${r.nombre} -- INSS Laboral (debe ser C$0)`, 0, r.inssLaboralReal);
  comparar(`${r.quincena} | ${r.nombre} -- Neto = Total Ingresos (sin deducción)`, r.totalIngresos, r.netoReal);
}
console.log(`Filas No-INSS comparadas: ${data.no_inss_quincenas.length}`);

console.log("\n" + "=".repeat(78));
console.log("VERIFICACIÓN 2/3 -- Personal INSS (El Buen Pastor): patrón quincenal 0%/14%");
console.log("=".repeat(78));
for (const r of data.inss_quincenas) {
  const inssLaboralCalculado = r.esSegundaQuincena
    ? calcularInssLaboral(r.salarioQuincenal * 2) // 7% del salario MENSUAL completo (= 14% de la quincena)
    : 0; // 1ra quincena: no se retiene nada, se acumula todo en la 2da
  comparar(`${r.quincena} | ${r.nombre} (${r.esSegundaQuincena ? "2da" : "1ra"} quinc.) -- INSS Laboral`, inssLaboralCalculado, r.inssLaboralReal);
  const netoCalculado = Math.round((r.totalIngresos - inssLaboralCalculado) * 100) / 100;
  comparar(`${r.quincena} | ${r.nombre} -- Neto a recibir`, netoCalculado, r.netoReal);
}
console.log(`Filas INSS (quincenal) comparadas: ${data.inss_quincenas.length}`);

console.log("\n" + "=".repeat(78));
console.log(`VERIFICACIÓN 3/3 -- "Piso de cotización" mensual (C$${PISO_COTIZACION_DOCENCIA_MENSUAL}) en declaraciones reales al INSS`);
console.log("=".repeat(78));
for (const r of data.inss_declaraciones) {
  const resultado = calcularInssConPisoCotizacion(r.salarioMensual);
  const etiqueta = `${r.mes} | ${r.nombre} (salario real C$${r.salarioMensual})`;
  comparar(`${etiqueta} -- Salario/base a reportar al INSS`, resultado.salarioBaseCotizable, r.salarioRealAReportar);
  comparar(`${etiqueta} -- INSS Laboral 7% por pagar al INSS`, resultado.inssLaboralPorPagarAlInss, r.inssLaboral7PorPagar);
  comparar(`${etiqueta} -- INSS Patronal 21.5% por pagar`, resultado.inssPatronalPorPagar, r.inssPatronal21_5PorPagar);
  // La deducción real al empleado en su cheque SIEMPRE es sobre su salario real (nunca el piso) -- confirmar con la misma hoja.
  comparar(`${etiqueta} -- INSS Laboral deducido AL EMPLEADO (sobre salario real)`, resultado.inssLaboralDeducidoAlEmpleado, r.inssLaboralDeducido);
}
console.log(`Declaraciones INSS comparadas: ${data.inss_declaraciones.length}`);

console.log("\n" + "=".repeat(78));
console.log("RESULTADO");
console.log("=".repeat(78));
console.log(`Comparaciones OK:       ${ok}`);
console.log(`Comparaciones fallidas: ${fallos}`);
if (fallosDetalle.length > 0) {
  console.log("\nDetalle de fallos:");
  for (const f of fallosDetalle) console.log(f);
}

if (fallos > 0) {
  console.log("\n❌ HAY DIFERENCIAS QUE NO CUADRAN CON EL EXCEL REAL DE EL BUEN PASTOR. Revisar antes de usar en producción.");
  process.exit(1);
} else {
  console.log(
    "\n✅ El patrón quincenal 0%/14% y el 'piso de cotización' de C$8,341.29 reproducen EXACTAMENTE (dentro de 5 centavos) los montos reales de las 2 planillas de El Buen Pastor (No-INSS e INSS)."
  );
}
