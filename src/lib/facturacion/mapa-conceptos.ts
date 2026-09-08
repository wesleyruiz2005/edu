import type { PrismaClient, ConceptoArancel } from "@prisma/client";
// @ts-ignore -- JSON fuera de src/, resolveJsonModule lo permite en tiempo de compilación real de Next/tsc.
import modalidadConceptosRaw from "../../../prisma/data/modalidad-conceptos.json";

export interface ConceptosPorModalidad {
  matricula: ConceptoArancel | null;
  mensualidad: ConceptoArancel | null;
  papeleria: ConceptoArancel | null;
  decimoTercero: ConceptoArancel | null;
}

type ClaveConcepto = "matricula" | "mensualidad" | "papeleria" | "decimoTercero";
type ConfigModalidad = Record<ClaveConcepto, string | null>;

const CLAVES: ClaveConcepto[] = ["matricula", "mensualidad", "papeleria", "decimoTercero"];

/**
 * Lee `prisma/data/modalidad-conceptos.json` (el mapa "qué Concepto de
 * Arancel le toca a cada Modalidad") y lo resuelve contra los
 * `ConceptoArancel` reales que ya están en la base de datos.
 *
 * Esto es lo que permite que el mismo motor de facturación sirva para el
 * Colegio El Mesías (modalidad "Educación Preescolar y Primaria") Y, el día
 * de mañana, para el Instituto Tecnológico (modalidades "Secundaria",
 * "Cursos Libres", "Carreras Técnicas", "ICCM") sin cambiar código -- solo
 * editando ese archivo JSON.
 */
export async function construirMapaDeConceptosPorModalidad(
  prisma: PrismaClient
): Promise<Record<string, ConceptosPorModalidad>> {
  const mapaCrudo = modalidadConceptosRaw as unknown as Record<string, ConfigModalidad>;

  const nombresConcepto = new Set<string>();
  for (const [modalidadNombre, config] of Object.entries(mapaCrudo)) {
    if (modalidadNombre.startsWith("_")) continue; // "_comentario", etc.
    for (const clave of CLAVES) {
      const nombre = config[clave];
      if (nombre) nombresConcepto.add(nombre);
    }
  }

  const conceptos = await prisma.conceptoArancel.findMany({
    where: { nombre: { in: Array.from(nombresConcepto) } },
  });
  const porNombre = new Map(conceptos.map((c) => [c.nombre, c]));

  const resultado: Record<string, ConceptosPorModalidad> = {};
  for (const [modalidadNombre, config] of Object.entries(mapaCrudo)) {
    if (modalidadNombre.startsWith("_")) continue;
    resultado[modalidadNombre] = {
      matricula: config.matricula ? porNombre.get(config.matricula) ?? null : null,
      mensualidad: config.mensualidad ? porNombre.get(config.mensualidad) ?? null : null,
      papeleria: config.papeleria ? porNombre.get(config.papeleria) ?? null : null,
      decimoTercero: config.decimoTercero ? porNombre.get(config.decimoTercero) ?? null : null,
    };
  }
  return resultado;
}
