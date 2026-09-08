/**
 * Hash/verificación de contraseñas con bcrypt (paquete `bcryptjs`, 100% en
 * JavaScript -- no necesita compilar nada nativo, así que `npm install`
 * funciona igual en cualquier computadora sin herramientas de compilación).
 */
import bcrypt from "bcryptjs";

/** Costo del hash -- 10 es el estándar recomendado (buen balance seguridad/velocidad). */
const RONDAS_SAL = 10;

export async function hashearPassword(passwordPlano: string): Promise<string> {
  return bcrypt.hash(passwordPlano, RONDAS_SAL);
}

export async function verificarPassword(passwordPlano: string, hash: string): Promise<boolean> {
  return bcrypt.compare(passwordPlano, hash);
}
