/**
 * Prueba rápida (sin base de datos) de las reglas de facturación y mora,
 * usando los MISMOS números reales que aparecen en el Excel de El Mesías.
 * Sirve para que Eduardo (o cualquiera) confirme que la fórmula es correcta
 * antes de conectarla a la base de datos real.
 *
 * Cómo correrlo (no necesita `npm install` ni Prisma, solo Node 22+):
 *   node --experimental-strip-types scripts/probar-reglas.ts
 */
import {
  calcularMontoFacturado,
  calcularFechaVencimiento,
  evaluarMora,
  type ConceptoParaCobro,
  type BecaAplicable,
} from "../src/lib/facturacion/reglas.ts";

let ok = 0;
let fail = 0;

function verificar(descripcion: string, obtenido: unknown, esperado: unknown) {
  const paso = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(`${paso ? "✅" : "❌"} ${descripcion} -> obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
  if (paso) ok++;
  else fail++;
}

const mensualidad: ConceptoParaCobro = { id: 1, esRecurrenteMensual: true };
const matricula: ConceptoParaCobro = { id: 2, esRecurrenteMensual: false };

// --- Caso 1: SHARON ISABEL ALVAREZ JIMENEZ (I Nivel, sin beca) ---
// Excel: Mensualidad = C$650 todos los meses.
verificar(
  "Sharon (sin beca) paga mensualidad completa",
  calcularMontoFacturado(650, mensualidad, null),
  650
);

// --- Caso 2: GAEL ISAIAS BARRERA LOPEZ (1er. Grado, Media Beca 50%) ---
// Excel: Mensualidad = C$325 (la mitad de 650), pero Matrícula y Papelería
// se le cobran COMPLETAS (C$650) porque la Media Beca solo aplica a
// Mensualidad -- así aparece literalmente en la hoja "Facturación".
const mediaBeca: BecaAplicable = {
  tipoCalculo: "PORCENTAJE",
  valor: 50,
  aplicaAConceptoId: null, // "general": solo toca conceptos recurrentes (Mensualidad)
};
verificar(
  "Gael (Media Beca 50%) paga mensualidad a mitad de precio",
  calcularMontoFacturado(650, mensualidad, mediaBeca),
  325
);
verificar(
  "Gael (Media Beca 50%) paga Matrícula COMPLETA (la beca no le toca)",
  calcularMontoFacturado(650, matricula, mediaBeca),
  650
);

// --- Caso 3: recargo por mora, ejemplo real de Detalle de Caja ---
// Nota real en el Excel: "SE APLICO MORA 650+65: 715" -> 650 de mensualidad
// + 65 de recargo (10% de 650) = 715 córdobas en total.
const reglaMora10 = { diaLimitePago: 5, porcentajeRecargo: 10 };
const vencimientoEnero = calcularFechaVencimiento(2026, 1, 5);
verificar(
  "Vencimiento de la mensualidad de Enero-2026 es el 5 de enero",
  vencimientoEnero.toISOString().slice(0, 10),
  "2026-01-05"
);

const pagoTardio = new Date(Date.UTC(2026, 0, 20)); // 20 de enero: ya pasó el día 5
const resultadoMora = evaluarMora(650, 650, vencimientoEnero, pagoTardio, reglaMora10, false);
verificar("El 20 de enero SÍ corresponde recargo por mora", resultadoMora.aplicaMora, true);
verificar("El recargo es C$65 (10% de 650)", resultadoMora.recargoMonto, 65);
verificar("Total a cobrar (650 + 65)", 650 + resultadoMora.recargoMonto, 715);

const pagoATiempo = new Date(Date.UTC(2026, 0, 3)); // 3 de enero: antes del día 5
const sinMora = evaluarMora(650, 650, vencimientoEnero, pagoATiempo, reglaMora10, false);
verificar("El 3 de enero NO corresponde recargo (pagó a tiempo)", sinMora.aplicaMora, false);

const yaPagado = evaluarMora(650, 0, vencimientoEnero, pagoTardio, reglaMora10, false);
verificar("Si el saldo ya es 0 (ya pagó), no se le duplica el recargo", yaPagado.aplicaMora, false);

const yaTeniaMora = evaluarMora(650, 715, vencimientoEnero, pagoTardio, reglaMora10, true);
verificar("Si el cargo YA tenía mora aplicada, no se le vuelve a sumar otra", yaTeniaMora.aplicaMora, false);

console.log(`\n${ok} pruebas correctas, ${fail} fallidas.`);
if (fail > 0) process.exit(1);
