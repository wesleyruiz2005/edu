/**
 * ============================================================================
 * PRUEBA DE VERIFICACIÓN -- Nóminas reales vs. fórmulas implementadas
 * ============================================================================
 * Este script NO usa la base de datos ni Prisma. Recalcula, con las
 * funciones puras de `src/lib/nomina/inss-ir.ts`, exactamente los mismos
 * montos que ya vienen en los 3 archivos Excel reales que Eduardo subió al
 * proyecto (04 NÓMINAS 2026 1., 04 NÓMINAS 2026 2, 04 NÓMINAS 2026 1) y
 * compara centavo a centavo.
 *
 * Los datos reales se extrajeron previamente de los 3 Excel con un script de
 * Python (openpyxl, leyendo VALORES ya calculados por Excel, no fórmulas) a
 * `nominas_reales.json`, ubicado junto a este script.
 *
 * Ejecutar con:
 *   node --experimental-strip-types scripts/probar-nominas-reales.ts
 *
 * (No usa `tsx` a propósito -- así esta prueba corre igual aunque
 * `node_modules` no esté instalado, porque `inss-ir.ts` no importa ningún
 * paquete externo.)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calcularInssLaboral,
  calcularInssPatronal,
  calcularInatecPatronal,
  calcularIrMensual,
  TASA_RETENCION_SERVICIO_PROFESIONAL,
  TASA_RETENCION_SERVICIO_GENERAL,
} from "../src/lib/nomina/inss-ir.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FijoReal {
  colegio: string;
  mes: string;
  nombre: string;
  cargo: string;
  salarioMensual: number;
  totalIngresos: number;
  viaticosTransporte: number;
  salarioCotizadoInss: number;
  inssLaboralReal: number;
  inssPatronalReal: number;
  inatecReal: number;
  netoReal: number;
}

interface ServicioReal {
  colegio: string;
  mes: string;
  nombre: string;
  tipoServicio: string;
  montoContrato: number;
  totalIngresos: number;
  deduccion10Real: number;
  deduccion2Real: number;
  totalDeduccionReal: number;
  netoReal: number;
}

// Ruta primaria: el JSON con los datos reales extraídos de los 3 Excel viaja
// DENTRO del paquete, junto a este script. Si no existe (por ejemplo
// corriendo dentro del sandbox de desarrollo original), cae a la ruta del
// scratchpad donde se generó por primera vez.
let raw: string;
try {
  raw = readFileSync(join(__dirname, "nominas-reales-extraidas.json"), "utf-8");
} catch {
  raw = readFileSync(
    "/tmp/claude-0/-home-claude/08af915d-d96e-5f8d-8689-3d414da41b98/scratchpad/nomina_verify/nominas_reales.json",
    "utf-8"
  );
}
const data: { fijo: FijoReal[]; servicios: ServicioReal[] } = JSON.parse(raw);

const TOLERANCIA = 0.01; // 1 centavo

let ok = 0;
let fallos = 0;
const fallosDetalle: string[] = [];
const advertencias: string[] = [];

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
console.log("VERIFICACIÓN 1/3 -- Personal Fijo (INSS Laboral 7% + INSS Patronal 21.5%)");
console.log("=".repeat(78));
for (const r of data.fijo) {
  const inssLaboral = calcularInssLaboral(r.totalIngresos, r.viaticosTransporte);
  const inssPatronal = calcularInssPatronal(r.salarioCotizadoInss, false);
  const inatec = calcularInatecPatronal(r.salarioCotizadoInss); // NO se suma (ver nota INATEC abajo)
  const netoCalculado = Math.round((r.totalIngresos - inssLaboral) * 100) / 100;

  const etiqueta = `${r.colegio} | ${r.mes} | ${r.nombre}`;
  comparar(`${etiqueta} -- INSS Laboral`, inssLaboral, r.inssLaboralReal);
  comparar(`${etiqueta} -- INSS Patronal (21.5%)`, inssPatronal, r.inssPatronalReal);
  comparar(`${etiqueta} -- Neto a recibir`, netoCalculado, r.netoReal);

  if (r.inatecReal !== 0) {
    advertencias.push(`  ⚠ ${etiqueta}: el Excel SÍ trae INATEC=${r.inatecReal} (se esperaba 0) -- revisar caso puntual.`);
  }
}

console.log(`Filas de personal fijo comparadas: ${data.fijo.length}`);

console.log("\n" + "=".repeat(78));
console.log("VERIFICACIÓN 2/3 -- Pago por Servicios del Instituto (10% / 2%)");
console.log("=".repeat(78));

let docenteAnomalias = 0;
for (const r of data.servicios) {
  const etiqueta = `${r.colegio} | ${r.mes} | ${r.nombre} (${r.tipoServicio})`;

  if (r.tipoServicio === "Servicio Profesional") {
    const retencion = Math.round(r.montoContrato * TASA_RETENCION_SERVICIO_PROFESIONAL * 100) / 100;
    comparar(`${etiqueta} -- Retención 10%`, retencion, r.deduccion10Real);
  } else if (r.tipoServicio === "Servicio General") {
    const retencion = Math.round(r.montoContrato * TASA_RETENCION_SERVICIO_GENERAL * 100) / 100;
    comparar(`${etiqueta} -- Retención 2%`, retencion, r.deduccion2Real);
  } else if (r.tipoServicio === "Docente") {
    // Fila etiquetada "Docente" en la hoja "Pago por Servicios" del
    // Instituto. Eduardo pidió explícitamente que los "docentes por hora"
    // se traten como Servicio Profesional (10%), pero en el Excel real
    // estas filas usan la MISMA fórmula que "Servicio General" (2%). No se
    // cuenta como fallo de la fórmula (el cálculo del 2% si reproduce el
    // Excel), se reporta aparte como inconsistencia de la plantilla a
    // confirmar con Eduardo -- ver bitácora.
    docenteAnomalias++;
    const retencion2 = Math.round(r.montoContrato * TASA_RETENCION_SERVICIO_GENERAL * 100) / 100;
    const coincideCon2 = Math.abs(retencion2 - r.deduccion2Real) <= TOLERANCIA;
    advertencias.push(
      `  ⚠ ${etiqueta}: en el Excel se le aplicó 2% (C$${r.deduccion2Real.toFixed(2)}) igual que "Servicio General"` +
        `${coincideCon2 ? "" : " (¡y tampoco cuadra con 2%!)"}, pero la regla que definiste dice que los docentes por hora` +
        ` deben llevar 10% de retención. Nuestro sistema SÍ va a aplicarles 10% (DOCENTE_HORARIO) -- confirmar si es correcto.`
    );
  } else {
    advertencias.push(`  ⚠ ${etiqueta}: tipo de servicio no reconocido ("${r.tipoServicio}").`);
  }
}
console.log(`Filas de servicios comparadas: ${data.servicios.length} (de las cuales ${docenteAnomalias} etiquetadas "Docente" con anomalía de plantilla)`);

console.log("\n" + "=".repeat(78));
console.log("RESULTADO");
console.log("=".repeat(78));
console.log(`Comparaciones OK:     ${ok}`);
console.log(`Comparaciones fallidas: ${fallos}`);
if (fallosDetalle.length > 0) {
  console.log("\nDetalle de fallos:");
  for (const f of fallosDetalle) console.log(f);
}
if (advertencias.length > 0) {
  console.log(`\nAdvertencias / hallazgos a confirmar con Eduardo (${advertencias.length}):`);
  for (const a of advertencias) console.log(a);
}

if (fallos > 0) {
  console.log("\n❌ HAY DIFERENCIAS QUE NO CUADRAN CON EL EXCEL REAL. Revisar antes de usar en producción.");
  process.exit(1);
} else {
  console.log("\n✅ Las fórmulas de INSS Laboral, INSS Patronal (21.5%) y las retenciones 10%/2% de Servicios reproducen EXACTAMENTE los montos de los 3 Excel reales (dentro de 1 centavo), salvo las anomalías de plantilla ya señaladas arriba.");
}
