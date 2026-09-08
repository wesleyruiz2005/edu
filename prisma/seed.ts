/**
 * Siembra los catálogos de cuentas contables de los DOS libros del sistema:
 *   - "COLEGIO": las 287 cuentas extraídas del Excel "Contabilidad_2026 El
 *     Mesías" (hoja "Balanza Total") -- compartidas por los 3 colegios.
 *   - "ICCM": las cuentas del libro "Sistema_Contable_ICCM_2026.xlsm" (hoja
 *     "Catalogo Contable") -- el Programa de Apadrinamiento, en dólares.
 *
 * Estos dos catálogos son DELIBERADAMENTE independientes: comparten algunos
 * códigos numéricos (ej. ambos tienen un "110101 Caja General") pero son
 * cuentas de "empresas" distintas -- por eso el código ya no es único a
 * secas, sino único DENTRO de cada libro (ver `LibroContable` en el schema).
 *
 * Uso:
 *   npm run seed
 *   (o, si prefieres el flujo estándar de Prisma:  npx prisma db seed)
 *
 * Cómo funciona (para cada libro, por separado):
 *   1) Primera pasada: crea (o actualiza) cada cuenta por su código, SIN
 *      todavía enlazar la cuenta padre (porque el padre puede no existir
 *      aún en la base de datos en ese momento).
 *   2) Segunda pasada: para cada cuenta que tiene `cuentaPadreCodigo`,
 *      busca el id de esa cuenta padre (en el MISMO libro) y actualiza el
 *      enlace.
 *
 * En el libro COLEGIO, 39 cuentas quedan marcadas "activo: false" -- son
 * códigos reservados que en el Excel original aparecen como "(Código
 * disponible)" o "XXXXXXXX". Quedan en la base de datos por si más adelante
 * se necesitan activar y ponerles nombre, pero no aparecen en los
 * selectores de la aplicación mientras `activo = false`.
 */

import { PrismaClient, TipoCuentaContable, ClaseCuenta, NaturalezaCuenta, LibroContable } from "@prisma/client";
import catalogoColegio from "./data/catalogo-cuentas.json";
import catalogoIccm from "./data/catalogo-cuentas-iccm.json";

const prisma = new PrismaClient();

type CuentaJson = {
  codigo: string;
  nombre: string;
  tipoCuenta: "MAYOR" | "DETALLE";
  clase: string;
  naturaleza: "DEUDORA" | "ACREEDORA";
  nivel: number;
  cuentaPadreCodigo: string | null;
  activo: boolean;
  libro: "COLEGIO" | "ICCM";
};

async function sembrarCatalogo(nombreLibro: string, cuentas: CuentaJson[]) {
  console.log(`\nSembrando catálogo "${nombreLibro}": ${cuentas.length} registros...`);
  const libro = cuentas[0]?.libro as LibroContable;

  // --- Paso 1: crear/actualizar cada cuenta sin el enlace al padre ---
  for (const c of cuentas) {
    await prisma.catalogoCuenta.upsert({
      where: { libro_codigo: { libro, codigo: c.codigo } },
      create: {
        libro,
        codigo: c.codigo,
        nombre: c.nombre,
        tipoCuenta: c.tipoCuenta as TipoCuentaContable,
        clase: c.clase as ClaseCuenta,
        naturaleza: c.naturaleza as NaturalezaCuenta,
        nivel: c.nivel,
        activo: c.activo,
      },
      update: {
        nombre: c.nombre,
        tipoCuenta: c.tipoCuenta as TipoCuentaContable,
        clase: c.clase as ClaseCuenta,
        naturaleza: c.naturaleza as NaturalezaCuenta,
        nivel: c.nivel,
        activo: c.activo,
      },
    });
  }
  console.log(`  Paso 1/2 listo: todas las cuentas de "${nombreLibro}" creadas/actualizadas.`);

  // --- Paso 2: enlazar cada cuenta con su cuenta padre (jerarquía) ---
  let enlazadas = 0;
  for (const c of cuentas) {
    if (!c.cuentaPadreCodigo) continue;
    const padre = await prisma.catalogoCuenta.findUnique({
      where: { libro_codigo: { libro, codigo: c.cuentaPadreCodigo } },
      select: { id: true },
    });
    if (!padre) {
      console.warn(`  ⚠ No se encontró la cuenta padre ${c.cuentaPadreCodigo} para ${c.codigo} (libro ${nombreLibro})`);
      continue;
    }
    await prisma.catalogoCuenta.update({
      where: { libro_codigo: { libro, codigo: c.codigo } },
      data: { cuentaPadreId: padre.id },
    });
    enlazadas++;
  }
  console.log(`  Paso 2/2 listo: ${enlazadas} cuentas de "${nombreLibro}" enlazadas con su cuenta padre.`);
}

async function main() {
  await sembrarCatalogo("COLEGIO", catalogoColegio as CuentaJson[]);
  await sembrarCatalogo("ICCM", catalogoIccm as CuentaJson[]);

  const total = await prisma.catalogoCuenta.count();
  const activas = await prisma.catalogoCuenta.count({ where: { activo: true } });
  console.log(`\n✅ Catálogos de cuentas sembrados: ${total} cuentas en total (${activas} activas, ${total - activas} reservadas sin usar).`);
}

main()
  .catch((e) => {
    console.error("Error sembrando los catálogos de cuentas:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
