/**
 * Genera los cargos ÚNICOS del año (Matrícula, Papelería y Décimo Tercer
 * Mes -- "Apertura Anual Masiva") para un colegio. Pensado para correrse al
 * matricular o promover a los estudiantes de un año lectivo.
 *
 * Uso:
 *   npm run facturar:anual -- --colegio=CMLM --anio=2026
 */
import { prisma } from "../src/lib/prisma";
import { generarCargosUnicosAnuales } from "../src/lib/facturacion/generar-cargos";
import { requerirArgumento, requerirArgumentoNumerico } from "./_cli-utils";

async function main() {
  const codigoColegio = requerirArgumento("colegio");
  const anio = requerirArgumentoNumerico("anio");

  const colegio = await prisma.colegio.findUnique({ where: { codigo: codigoColegio } });
  if (!colegio) throw new Error(`No existe ningún colegio con código "${codigoColegio}".`);

  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio } });
  if (!anioLectivo) throw new Error(`No existe el año lectivo ${anio}. Créalo primero en la tabla anios_lectivos.`);

  console.log(`Generando cargos de Matrícula, Papelería y Décimo Tercer Mes — ${colegio.nombre}, año ${anio}...\n`);

  const resumen = await generarCargosUnicosAnuales(prisma, {
    colegioId: colegio.id,
    anioLectivoId: anioLectivo.id,
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

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
