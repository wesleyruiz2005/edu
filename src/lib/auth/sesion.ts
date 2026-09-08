/**
 * Envoltorio de sesión para usar SOLO en Server Actions / Server Components
 * / Route Handlers (runtime Node.js normal -- no en `src/middleware.ts`,
 * que usa las funciones "puras" de `sesion-nucleo.ts` directamente porque
 * corre en el runtime Edge y no puede usar `next/headers`).
 */
import { cookies } from "next/headers";
import {
  DURACION_SESION_SEG,
  NOMBRE_COOKIE_SESION,
  firmarSesion,
  verificarSesion,
  type DatosSesion,
} from "./sesion-nucleo";

/** Firma y guarda la cookie de sesión httpOnly. Llamar justo después de validar usuario/contraseña. */
export async function crearCookieSesion(datos: Omit<DatosSesion, "exp">): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + DURACION_SESION_SEG;
  const valor = await firmarSesion({ ...datos, exp });
  const almacen = await cookies();
  almacen.set(NOMBRE_COOKIE_SESION, valor, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DURACION_SESION_SEG,
  });
}

/** Lee y valida la sesión actual. `null` si no hay nadie logueado (o la cookie venció/es inválida). */
export async function obtenerSesionActual(): Promise<DatosSesion | null> {
  const almacen = await cookies();
  return verificarSesion(almacen.get(NOMBRE_COOKIE_SESION)?.value);
}

export async function destruirCookieSesion(): Promise<void> {
  const almacen = await cookies();
  almacen.delete(NOMBRE_COOKIE_SESION);
}
