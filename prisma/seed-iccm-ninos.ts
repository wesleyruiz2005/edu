/**
 * Siembra la tabla `iccm_ninos` (el maestro de niños patrocinados) a partir
 * de `prisma/data/iccm-ninos.json`, extraído de la hoja "BD_PADRINOS_NINOS"
 * de `Apadrinamientos_Consolidado_2026.xlsx` -- 253 niños con su código NC,
 * colegio, patrocinador, cuota mensual y estatus actual.
 *
 * Este paso es un PREREQUISITO de `scripts/importar-historico-iccm.ts`:
 * las asignaciones mensuales, regalos y ajustes históricos se enlazan a un
 * niño por su `codigoNc`, así que el maestro tiene que existir primero.
 *
 * Uso: npm run seed:iccm-ninos
 */
import { PrismaClient } from "@prisma/client";
import ninosJson from "./data/iccm-ninos.json";

const prisma = new PrismaClient();

interface NinoJson {
  codigoNc: string;
  nombreCompleto: string;
  colegioCodigo: string;
  patrocinadorNombre: string | null;
  cuotaMensualUsd: number;
  estado: "ACTIVO" | "EN_ESPERA" | "DE_BAJA";
}

async function main() {
  const ninos = ninosJson as NinoJson[];
  let creados = 0;
  let actualizados = 0;

  for (const n of ninos) {
    const colegio = await prisma.colegio.findUnique({ where: { codigo: n.colegioCodigo } });
    if (!colegio) {
      throw new Error(
        `No existe el colegio "${n.colegioCodigo}" (niño ${n.codigoNc}). Corre "npm run seed:aranceles" primero para cargar los colegios.`
      );
    }

    const existente = await prisma.iccmNino.findUnique({ where: { codigoNc: n.codigoNc } });
    await prisma.iccmNino.upsert({
      where: { codigoNc: n.codigoNc },
      create: {
        codigoNc: n.codigoNc,
        colegioId: colegio.id,
        nombreCompleto: n.nombreCompleto,
        patrocinadorNombre: n.patrocinadorNombre,
        cuotaMensualUsd: n.cuotaMensualUsd,
        estado: n.estado,
      },
      update: {
        colegioId: colegio.id,
        nombreCompleto: n.nombreCompleto,
        patrocinadorNombre: n.patrocinadorNombre,
        cuotaMensualUsd: n.cuotaMensualUsd,
        estado: n.estado,
      },
    });
    if (existente) actualizados++;
    else creados++;
  }

  console.log(`✅ Niños ICCM: ${creados} creados, ${actualizados} actualizados (total ${ninos.length}).`);
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
