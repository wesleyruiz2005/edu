/**
 * Crea (o actualiza) los 3 usuarios de prueba para iniciar sesión en el
 * navegador durante la prueba local (pedido de Eduardo, 7 sept 2026):
 *   - cajera   -> rol CAJERA          -> Pantalla de Cajera exclusivamente.
 *   - contador -> rol CONTADOR        -> Egresos, Nóminas, DGI, Libro Diario/Mayor, Cierres.
 *   - junta    -> rol JUNTA_DIRECTIVA -> Dashboard Consolidado + auditoría ICCM.
 *
 * Las contraseñas de abajo son SOLO para la prueba local -- cámbialas (o
 * crea usuarios nuevos con contraseñas propias) antes de usar el sistema
 * con datos reales de producción.
 *
 * Uso:
 *   npm run seed:usuarios
 *   (ya viene incluido también dentro de "npm run seed")
 *
 * Se usa `upsert` por `usuario` (campo único) para que correr este script
 * más de una vez no duplique nada -- solo actualiza el hash/rol si cambió.
 */
import { PrismaClient, RolUsuario } from "@prisma/client";
import { hashearPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

interface UsuarioPrueba {
  usuario: string;
  nombreCompleto: string;
  passwordPlano: string;
  rol: RolUsuario;
}

const USUARIOS_DE_PRUEBA: UsuarioPrueba[] = [
  { usuario: "cajera", nombreCompleto: "Cajera de Prueba", passwordPlano: "Cajera#2026", rol: "CAJERA" },
  { usuario: "contador", nombreCompleto: "Contador de Prueba", passwordPlano: "Contador#2026", rol: "CONTADOR" },
  { usuario: "junta", nombreCompleto: "Junta Directiva (Prueba)", passwordPlano: "Junta#2026", rol: "JUNTA_DIRECTIVA" },
];

async function main() {
  for (const u of USUARIOS_DE_PRUEBA) {
    const passwordHash = await hashearPassword(u.passwordPlano);
    await prisma.usuario.upsert({
      where: { usuario: u.usuario },
      update: { nombreCompleto: u.nombreCompleto, passwordHash, rol: u.rol, activo: true },
      create: { usuario: u.usuario, nombreCompleto: u.nombreCompleto, passwordHash, rol: u.rol },
    });
    console.log(`  Usuario listo: "${u.usuario}" (${u.rol})`);
  }
  console.log(`\n✅ ${USUARIOS_DE_PRUEBA.length} usuarios de prueba creados/actualizados.`);
  console.log('   Contraseñas: ver "prisma/seed-usuarios.ts" o el mensaje que te dio Claude -- son SOLO para prueba local.');
}

main()
  .catch((e) => {
    console.error("Error sembrando los usuarios de prueba:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
