/**
 * ============================================================================
 * MIDDLEWARE DE AUTENTICACIÓN
 * ============================================================================
 * Corre ANTES de cada página (en el "borde" -- Edge runtime de Next.js, por
 * eso importa solo de `sesion-nucleo.ts` y `roles.ts`, que no tocan
 * `@prisma/client` ni `next/headers`, incompatibles con Edge).
 *
 *   1) Sin sesión válida  -> redirige a /login (excepto /login mismo).
 *   2) Con sesión pero sin permiso para esa URL (según su rol, ver
 *      `roles.ts`) -> redirige a "/" (ahí el menú ya le muestra solo lo
 *      que sí puede ver).
 *   3) Ya logueado e intenta entrar a /login -> lo manda directo a "/".
 */
import { NextResponse, type NextRequest } from "next/server";
import { NOMBRE_COOKIE_SESION, verificarSesion } from "./lib/auth/sesion-nucleo";
import { rutaPermitidaParaRol } from "./lib/auth/roles";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const cookieSesion = request.cookies.get(NOMBRE_COOKIE_SESION)?.value;
  const sesion = await verificarSesion(cookieSesion);

  if (pathname === "/login") {
    if (sesion) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  // "/logout" no tiene módulo propio en `roles.ts` (no es una pantalla,
  // solo borra la cookie) -- se deja pasar siempre, con o sin sesión.
  if (pathname === "/logout") {
    return NextResponse.next();
  }

  if (!sesion) {
    const destino = new URL("/login", request.url);
    return NextResponse.redirect(destino);
  }

  if (!rutaPermitidaParaRol(pathname, sesion.rol)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Corre en todo menos archivos estáticos/internos de Next.js.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
