/**
 * Siembra `niveles_academicos` (a partir de `prisma/data/niveles-academicos.json`,
 * extraído de la columna "Nivel Académico" de la Base de Datos de El Mesías)
 * y `tipos_beca` (`prisma/data/tipos-beca.json`).
 *
 * Prerequisito de `scripts/importar-estudiantes-el-mesias.ts`.
 * Uso: npm run seed:niveles-becas
 */
import { PrismaClient } from "@prisma/client";
import nivelesJson from "./data/niveles-academicos.json";
import tiposBecaJson from "./data/tipos-beca.json";

const prisma = new PrismaClient();

interface NivelJson {
  nombre: string;
  modalidad: string;
  orden: number;
  esNivelGraduacion: boolean;
}

interface TipoBecaJson {
  nombre: string;
  tipoCalculo: "PORCENTAJE" | "MONTO_FIJO";
  valor: number;
  aplicaAConcepto: string | null;
}

async function main() {
  const niveles = nivelesJson as NivelJson[];
  for (const n of niveles) {
    const modalidad = await prisma.modalidad.findUnique({ where: { nombre: n.modalidad } });
    if (!modalidad) {
      throw new Error(`No existe la modalidad "${n.modalidad}" (nivel "${n.nombre}"). Corre "npm run seed:aranceles" primero.`);
    }
    await prisma.nivelAcademico.upsert({
      where: { nombre_modalidadId: { nombre: n.nombre, modalidadId: modalidad.id } },
      create: { nombre: n.nombre, modalidadId: modalidad.id, orden: n.orden, esNivelGraduacion: n.esNivelGraduacion },
      update: { orden: n.orden, esNivelGraduacion: n.esNivelGraduacion },
    });
  }
  console.log(`✅ ${niveles.length} niveles académicos sembrados.`);

  const tiposBeca = tiposBecaJson as TipoBecaJson[];
  for (const t of tiposBeca) {
    let aplicaAConceptoId: number | null = null;
    if (t.aplicaAConcepto) {
      const concepto = await prisma.conceptoArancel.findFirst({ where: { nombre: t.aplicaAConcepto } });
      if (!concepto) throw new Error(`No existe el concepto de arancel "${t.aplicaAConcepto}" (beca "${t.nombre}").`);
      aplicaAConceptoId = concepto.id;
    }
    const existente = await prisma.tipoBeca.findFirst({ where: { nombre: t.nombre } });
    if (existente) {
      await prisma.tipoBeca.update({
        where: { id: existente.id },
        data: { tipoCalculo: t.tipoCalculo, valor: t.valor, aplicaAConceptoId },
      });
    } else {
      await prisma.tipoBeca.create({
        data: { nombre: t.nombre, tipoCalculo: t.tipoCalculo, valor: t.valor, aplicaAConceptoId },
      });
    }
  }
  console.log(`✅ ${tiposBeca.length} tipos de beca sembrados.`);
}

main()
  .catch((e) => {
    console.error("❌", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
