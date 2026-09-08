/**
 * Prueba rápida (sin base de datos) de las reglas del Módulo de Pago a
 * Proveedores y del Módulo de Nóminas -- igual que `probar-reglas.ts`, para
 * que Eduardo pueda confirmar los números antes de conectarlos a la base de
 * datos real.
 *
 * Cómo correrlo (no necesita base de datos, solo `npm install` ya hecho):
 *   npm run probar-modulo-pago
 * (usa `tsx` -- a diferencia de `probar-reglas.ts`, estos archivos SÍ
 * importan otros módulos locales entre sí, y `node --experimental-strip-types`
 * exige poner la extensión ".ts" en cada import relativo; `tsx` resuelve
 * igual que Next.js, sin ese problema).
 */
import { calcularRetencion, proveedorEstaExonerado } from "../src/lib/pagos/retencion.ts";
import { letraDeMes } from "../src/lib/caja/comprobante-utils.ts";
import { calcularDeduccionesNomina } from "../src/lib/nomina/registrar-planilla.ts";

let ok = 0;
let fail = 0;

function verificar(descripcion: string, obtenido: unknown, esperado: unknown) {
  const paso = JSON.stringify(obtenido) === JSON.stringify(esperado);
  console.log(`${paso ? "✅" : "❌"} ${descripcion} -> obtenido=${JSON.stringify(obtenido)} esperado=${JSON.stringify(esperado)}`);
  if (paso) ok++;
  else fail++;
}

// ============================================================================
// Retención de pagos a proveedores (punto 7)
// ============================================================================

verificar(
  "Compra/servicio general C$1,500 (sin IVA separado) -> 2% = C$30",
  calcularRetencion({ tipoGasto: "COMPRA_O_SERVICIO_GENERAL", montoFactura: 1500, proveedorExonerado: false }).monto,
  30
);

verificar(
  "Compra/servicio general C$1,000 exactos -> NO aplica (regla es 'mayor a C$1,000')",
  calcularRetencion({ tipoGasto: "COMPRA_O_SERVICIO_GENERAL", montoFactura: 1000, proveedorExonerado: false }).monto,
  0
);

verificar(
  "Compra/servicio general C$1,160 factura (C$1,000 antes de IVA 15%) -> 2% se calcula sobre los C$1,000 antes de IVA = C$20",
  calcularRetencion({ tipoGasto: "COMPRA_O_SERVICIO_GENERAL", montoFactura: 1160, baseImponibleSinIva: 1000, proveedorExonerado: false }).monto,
  20
);

verificar(
  "Servicio profesional C$5,000 -> 10% sobre el total = C$500",
  calcularRetencion({ tipoGasto: "SERVICIO_PROFESIONAL", montoFactura: 5000, proveedorExonerado: false }).monto,
  500
);

verificar(
  "Proveedor con constancia de no retención vigente -> C$0 de retención SIEMPRE (aunque sea servicio profesional grande)",
  calcularRetencion({ tipoGasto: "SERVICIO_PROFESIONAL", montoFactura: 50000, proveedorExonerado: true }).monto,
  0
);

// ============================================================================
// Vigencia de la constancia de no retención
// ============================================================================

const hoy = new Date("2026-09-07");
verificar(
  "Constancia vigente hasta una fecha futura -> exonerado",
  proveedorEstaExonerado({ tieneConstanciaNoRetencion: true, constanciaVigenciaHasta: new Date("2026-12-31") }, hoy),
  true
);
verificar(
  "Constancia vencida (fecha pasada) -> NO exonerado",
  proveedorEstaExonerado({ tieneConstanciaNoRetencion: true, constanciaVigenciaHasta: new Date("2026-01-01") }, hoy),
  false
);
verificar(
  "Sin constancia -> NO exonerado",
  proveedorEstaExonerado({ tieneConstanciaNoRetencion: false, constanciaVigenciaHasta: null }, hoy),
  false
);
verificar(
  "Constancia marcada pero sin fecha de vencimiento -> se asume vigente (avisar a Eduardo para que confirme fecha real)",
  proveedorEstaExonerado({ tieneConstanciaNoRetencion: true, constanciaVigenciaHasta: null }, hoy),
  true
);

// ============================================================================
// Numeración "YY-X-NN" (punto 5) -- letra de mes
// ============================================================================

verificar("Enero -> letra A", letraDeMes(1), "A");
verificar("Agosto -> letra H (coincide con el histórico ICCM 'H-01')", letraDeMes(8), "H");
verificar("Diciembre -> letra L", letraDeMes(12), "L");
try {
  letraDeMes(13);
  verificar("Mes 13 debería lanzar error", "no lanzó", "lanzó error");
} catch {
  verificar("Mes 13 lanza error (mes inválido)", "lanzó error", "lanzó error");
}

// ============================================================================
// Retenciones/INSS de nómina -- confirmadas contra los 3 Excel reales de
// nómina que Eduardo subió (ver `probar-nominas-reales.ts` para la prueba
// completa, empleado por empleado, contra esos mismos archivos).
// ============================================================================

verificar(
  "Docente por hora / Servicio Profesional (Instituto) C$8,000 -> 10% de retención = C$800",
  calcularDeduccionesNomina("DOCENTE_HORARIO", 8000).montoRetencionServicios,
  800
);
verificar(
  "Contrato de servicios generales (Instituto) C$8,000 -> 2% de retención = C$160",
  calcularDeduccionesNomina("CONTRATO_SERVICIOS_GENERALES", 8000).montoRetencionServicios,
  160
);
verificar(
  "Personal fijo C$8,700 -> INSS Laboral 7% = C$609 (igual que Jamileth Jiménez, Instituto, AGOST 2026)",
  calcularDeduccionesNomina("PERSONAL_FIJO", 8700).inssLaboral,
  609
);
verificar(
  "Personal fijo C$8,700 -> INSS Patronal 21.5% = C$1,870.50 (igual que Jamileth Jiménez, Instituto, AGOST 2026)",
  calcularDeduccionesNomina("PERSONAL_FIJO", 8700).inssPatronal,
  1870.5
);

console.log(`\n${ok} pruebas OK, ${fail} fallidas.`);
console.log("Para la prueba COMPLETA contra los 3 Excel reales de nómina (166 filas de personal fijo + 33 de servicios), correr:");
console.log("  npm run probar-nominas-reales");
if (fail > 0) process.exit(1);
