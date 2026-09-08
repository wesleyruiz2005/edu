/**
 * Prueba de humo (sin base de datos) del núcleo de autenticación:
 *   1) hashear/verificar contraseña con bcrypt.
 *   2) firmar y verificar una cookie de sesión (HMAC), incluyendo que una
 *      cookie manipulada o vencida se rechace.
 * Se corre con: node --experimental-strip-types scripts/probar-auth.ts
 */
import { hashearPassword, verificarPassword } from "../src/lib/auth/password.ts";
import { firmarSesion, verificarSesion, type DatosSesion } from "../src/lib/auth/sesion-nucleo.ts";

let ok = 0;
let fallidas = 0;

function assert(condicion: boolean, mensaje: string) {
  if (condicion) {
    ok++;
    console.log(`  OK: ${mensaje}`);
  } else {
    fallidas++;
    console.log(`  FALLO: ${mensaje}`);
  }
}

async function main() {
  console.log("1) Contraseñas (bcrypt)");
  const hash = await hashearPassword("Cajera#2026");
  assert(hash !== "Cajera#2026", "el hash no es la contraseña en texto plano");
  assert(await verificarPassword("Cajera#2026", hash), "la contraseña correcta verifica OK");
  assert(!(await verificarPassword("otra-cosa", hash)), "una contraseña incorrecta NO verifica");

  console.log("2) Sesión firmada (HMAC)");
  const datos: DatosSesion = {
    usuarioId: 1,
    usuario: "cajera",
    nombreCompleto: "Cajera de Prueba",
    rol: "CAJERA",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const cookie = await firmarSesion(datos);
  assert(typeof cookie === "string" && cookie.includes("."), "la cookie firmada tiene forma payload.firma");

  const verificado = await verificarSesion(cookie);
  assert(verificado !== null && verificado.usuario === "cajera" && verificado.rol === "CAJERA", "la cookie válida se verifica y trae los datos correctos");

  const manipulada = cookie.slice(0, -2) + "xx";
  assert((await verificarSesion(manipulada)) === null, "una cookie manipulada se rechaza");

  const vencida = await firmarSesion({ ...datos, exp: Math.floor(Date.now() / 1000) - 10 });
  assert((await verificarSesion(vencida)) === null, "una cookie vencida se rechaza");

  assert((await verificarSesion(undefined)) === null, "sin cookie -> null (no explota)");
  assert((await verificarSesion("basura-sin-formato")) === null, "cookie con formato inválido -> null (no explota)");

  console.log(`\n${ok}/${ok + fallidas} OK`);
  if (fallidas > 0) process.exit(1);
}

main();
