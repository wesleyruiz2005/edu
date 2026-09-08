/**
 * Siembra los catálogos base que necesita el Módulo de Facturación:
 *   1) Colegios       (los 3 colegios -- edita `data/colegios.json` con los
 *                       nombres reales antes de correr esto en producción)
 *   2) Modalidades     (Preescolar/Primaria, Secundaria, Cursos Libres,
 *                       Carreras Técnicas, ICCM)
 *   3) Conceptos de Arancel (Matrícula, Mensualidad, Papelería, Décimo
 *                       Tercer Mes... ya amarrados a su cuenta contable)
 *   4) Regla de Mora   (10% de recargo después del día 5, tal como pediste)
 *
 * Requiere que YA hayas corrido `npm run seed` (el catálogo de 286 cuentas),
 * porque los conceptos de arancel se enlazan a esas cuentas por su código.
 *
 * Uso:
 *   npm run seed:aranceles
 *   (o ya viene incluido dentro de "npm run seed" -- ver package.json)
 */
import { PrismaClient, TipoColegio } from "@prisma/client";
import colegios from "./data/colegios.json";
import modalidades from "./data/modalidades.json";
import conceptosArancel from "./data/conceptos-arancel.json";
import reglasMora from "./data/reglas-mora.json";

const prisma = new PrismaClient();

type ColegioJson = {
  codigo: string;
  nombre: string;
  tipo: "PREESCOLAR_PRIMARIA" | "INSTITUTO_TECNICO";
  activo?: boolean;
  prefijoIccm?: string;
};

type ConceptoJson = {
  nombre: string;
  cuentaCodigo: string;
  esRecurrenteMensual: boolean;
  aplicaRecargoMora: boolean;
};

type ReglaMoraJson = {
  colegioCodigo: string | null;
  diaLimitePago: number;
  porcentajeRecargo: number;
  vigenteDesde: string;
};

async function main() {
  // --- 1) Colegios ---
  console.log("Sembrando colegios...");
  for (const raw of colegios as ColegioJson[]) {
    if (!raw.codigo || raw.codigo.startsWith("PENDIENTE")) {
      console.warn(
        `⚠ Saltando colegio con código "${raw.codigo}" -- edita prisma/data/colegios.json con el nombre/código real y vuelve a correr este seed.`
      );
      continue;
    }
    await prisma.colegio.upsert({
      where: { codigo: raw.codigo },
      create: {
        codigo: raw.codigo,
        nombre: raw.nombre,
        tipo: raw.tipo as TipoColegio,
        activo: raw.activo ?? true,
        prefijoIccm: raw.prefijoIccm ?? null,
      },
      update: {
        nombre: raw.nombre,
        tipo: raw.tipo as TipoColegio,
        activo: raw.activo ?? true,
        prefijoIccm: raw.prefijoIccm ?? null,
      },
    });
  }

  // --- 2) Modalidades ---
  console.log("Sembrando modalidades...");
  for (const m of modalidades as { nombre: string }[]) {
    await prisma.modalidad.upsert({
      where: { nombre: m.nombre },
      create: { nombre: m.nombre },
      update: {},
    });
  }

  // --- 3) Conceptos de Arancel (enlazados a su cuenta contable) ---
  console.log("Sembrando conceptos de arancel...");
  let conceptosCreados = 0;
  for (const c of conceptosArancel as ConceptoJson[]) {
    const cuenta = await prisma.catalogoCuenta.findUnique({
      // Los Conceptos de Arancel siempre usan cuentas del libro COLEGIO
      // (el patrocinio de ICCM no pasa por cargos_estudiante).
      where: { libro_codigo: { libro: "COLEGIO", codigo: c.cuentaCodigo } },
      select: { id: true },
    });
    if (!cuenta) {
      console.warn(
        `⚠ No se encontró la cuenta contable ${c.cuentaCodigo} para el concepto "${c.nombre}". ¿Corriste primero "npm run seed" (catálogo de cuentas)? Se omite este concepto.`
      );
      continue;
    }
    await prisma.conceptoArancel.upsert({
      where: { nombre: c.nombre },
      create: {
        nombre: c.nombre,
        cuentaContableId: cuenta.id,
        esRecurrenteMensual: c.esRecurrenteMensual,
        aplicaRecargoMora: c.aplicaRecargoMora,
      },
      update: {
        cuentaContableId: cuenta.id,
        esRecurrenteMensual: c.esRecurrenteMensual,
        aplicaRecargoMora: c.aplicaRecargoMora,
      },
    });
    conceptosCreados++;
  }

  // --- 4) Reglas de mora ---
  console.log("Sembrando reglas de mora...");
  for (const r of reglasMora as ReglaMoraJson[]) {
    let colegioId: number | null = null;
    if (r.colegioCodigo) {
      const colegio = await prisma.colegio.findUnique({
        where: { codigo: r.colegioCodigo },
        select: { id: true },
      });
      if (!colegio) {
        console.warn(`⚠ No se encontró el colegio "${r.colegioCodigo}" para esta regla de mora. Se omite.`);
        continue;
      }
      colegioId = colegio.id;
    }
    // No hay un "upsert" natural aquí (la tabla no tiene una llave única
    // simple para colegio+vigencia), así que evitamos duplicar buscando
    // primero si ya existe una regla igual.
    const existente = await prisma.reglaMora.findFirst({
      where: { colegioId, vigenteDesde: new Date(r.vigenteDesde) },
    });
    if (existente) {
      await prisma.reglaMora.update({
        where: { id: existente.id },
        data: { diaLimitePago: r.diaLimitePago, porcentajeRecargo: r.porcentajeRecargo },
      });
    } else {
      await prisma.reglaMora.create({
        data: {
          colegioId,
          diaLimitePago: r.diaLimitePago,
          porcentajeRecargo: r.porcentajeRecargo,
          vigenteDesde: new Date(r.vigenteDesde),
        },
      });
    }
  }

  console.log(`\n✅ Catálogos de facturación listos: colegios, modalidades, ${conceptosCreados} conceptos de arancel y regla(s) de mora.`);
}

main()
  .catch((e) => {
    console.error("Error sembrando los catálogos de facturación:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
