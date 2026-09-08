/**
 * Genera los cargos de MENSUALIDAD de un mes para un colegio.
 *
 * Uso:
 *   npm run facturar:mensual -- --colegio=CMLM --anio=2026 --mes=9
 *
 * Es seguro correrlo más de una vez para el mismo mes: no duplica cargos,
 * y si un cargo ya tiene un pago registrado, lo deja intacto.
 */
import { prisma } from "../src/lib/prisma";
import { generarCargosMensuales } from "../src/lib/facturacion/generar-cargos";
import { requerirArgumento, requerirArgumentoNumerico } from "./_cli-utils";

async function main() {
  const codigoColegio = requerirArgumento("colegio");
  const anio = requerirArgumentoNumerico("anio");
  const mes = requerirArgumentoNumerico("mes");

  const colegio = await prisma.colegio.findUnique({ where: { codigo: codigoColegio } });
  if (!colegio) throw new Error(`No existe ningún colegio con código "${codigoColegio}".`);

  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio } });
  if (!anioLectivo) throw new Error(`No existe el año lectivo ${anio}. Créalo primero en la tabla anios_lectivos.`);

  console.log(`Generando cargos de Mensualidad — ${colegio.nombre}, ${nombreMes(mes)} ${anio}...\n`);

  const resumen = await generarCargosMensuales(prisma, {
    colegioId: colegio.id,
    anioLectivoId: anioLectivo.id,
    mes,
  });

  console.log(`Cargos nuevos creados:        ${resumen.creados}`);
  console.log(`Cargos actualizados:          ${resumen.actualizados}`);
  console.log(`Cargos sin cambios:           ${resumen.sinCambios}`);
  console.log(`Omitidos (ya tenían pagos):   ${resumen.omitidosTienenPagos}`);
  if (resumen.advertencias.length > 0) {
    console.log(`\n⚠ Advertencias (${resumen.advertencias.length}):`);
    for (const a of resumen.advertencias) console.log(`  - ${a}`);
  }
}

function nombreMes(mes: number): string {
  const nombres = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  return nombres[mes - 1] ?? `Mes ${mes}`;
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
