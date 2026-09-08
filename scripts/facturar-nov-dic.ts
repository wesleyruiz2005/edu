/**
 * Regla fija del 01 de noviembre: factura Noviembre Y Diciembre juntos.
 *
 * Uso:
 *   npm run facturar:nov-dic -- --colegio=CMLM --anio=2026
 */
import { prisma } from "../src/lib/prisma";
import { generarCargosNoviembreYDiciembre } from "../src/lib/facturacion/generar-cargos";
import { requerirArgumento, requerirArgumentoNumerico } from "./_cli-utils";

async function main() {
  const codigoColegio = requerirArgumento("colegio");
  const anio = requerirArgumentoNumerico("anio");

  const colegio = await prisma.colegio.findUnique({ where: { codigo: codigoColegio } });
  if (!colegio) throw new Error(`No existe ningún colegio con código "${codigoColegio}".`);

  const anioLectivo = await prisma.anioLectivo.findUnique({ where: { anio } });
  if (!anioLectivo) throw new Error(`No existe el año lectivo ${anio}.`);

  console.log(`Generando cargos de Noviembre Y Diciembre juntos — ${colegio.nombre}, ${anio}...\n`);

  const { noviembre, diciembre } = await generarCargosNoviembreYDiciembre(prisma, {
    colegioId: colegio.id,
    anioLectivoId: anioLectivo.id,
  });

  console.log("Noviembre ->", noviembre);
  console.log("Diciembre ->", diciembre);
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
