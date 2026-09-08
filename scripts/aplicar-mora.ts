/**
 * Aplica el recargo por mora (10% después del día 5) a todos los cargos
 * vencidos y sin pagar. Pensado para correrse UNA VEZ AL DÍA (ver nota al
 * final del archivo sobre cómo automatizarlo).
 *
 * Uso:
 *   npm run aplicar-mora                    -> revisa los 3 colegios
 *   npm run aplicar-mora -- --colegio=CMLM  -> revisa solo ese colegio
 */
import { prisma } from "../src/lib/prisma";
import { aplicarRecargosPorMora } from "../src/lib/facturacion/mora";
import { leerArgumento } from "./_cli-utils";

async function main() {
  const codigoColegio = leerArgumento("colegio");
  let colegioId: number | undefined;

  if (codigoColegio) {
    const colegio = await prisma.colegio.findUnique({ where: { codigo: codigoColegio } });
    if (!colegio) throw new Error(`No existe ningún colegio con código "${codigoColegio}".`);
    colegioId = colegio.id;
  }

  console.log(`Revisando cargos vencidos${codigoColegio ? ` de ${codigoColegio}` : " de todos los colegios"}...\n`);

  const resumen = await aplicarRecargosPorMora(prisma, { colegioId });

  console.log(`Cargos revisados:               ${resumen.cargosRevisados}`);
  console.log(`Cargos con recargo nuevo:       ${resumen.cargosConMoraNueva}`);
  console.log(`Total de recargos aplicados:    C$ ${resumen.montoTotalRecargos.toFixed(2)}`);
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

/**
 * ¿Cómo hacer que esto corra solo, todos los días, sin que Eduardo tenga
 * que acordarse de escribir el comando?
 *   - En Vercel (donde vamos a publicar la aplicación): un "Vercel Cron
 *     Job" que llame una API interna (ej. /api/cron/aplicar-mora) todos
 *     los días a las 6:00 a.m. -- esto lo dejamos armado cuando construyamos
 *     la aplicación web, no requiere que nadie encienda una computadora.
 */
