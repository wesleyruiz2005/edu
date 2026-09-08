import type { PrismaClient, ReglaMora } from "@prisma/client";

/**
 * Devuelve la regla de mora que le corresponde a un colegio:
 *  - si existe una regla específica para ESE colegio, la usa;
 *  - si no, cae a la regla global (colegio_id = null), la que aplica
 *    "a los 3 colegios" mientras no se configure algo distinto.
 * Si hay varias vigentes, usa la más reciente (vigente_desde más cercana a
 * la fecha de evaluación, sin pasarse de ella).
 */
export async function obtenerReglaMoraVigente(
  prisma: PrismaClient,
  colegioId: number,
  fecha: Date
): Promise<ReglaMora> {
  const especifica = await prisma.reglaMora.findFirst({
    where: { colegioId, vigenteDesde: { lte: fecha } },
    orderBy: { vigenteDesde: "desc" },
  });
  if (especifica) return especifica;

  const global = await prisma.reglaMora.findFirst({
    where: { colegioId: null, vigenteDesde: { lte: fecha } },
    orderBy: { vigenteDesde: "desc" },
  });
  if (global) return global;

  throw new Error(
    `No hay ninguna regla de mora configurada (ni para el colegio #${colegioId} ni una regla global). Corre "npm run seed:aranceles" o crea una manualmente en la tabla reglas_mora.`
  );
}
