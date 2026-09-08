import { NextResponse, type NextRequest } from "next/server";
import { destruirCookieSesion } from "../../lib/auth/sesion";

/** Link de "Cerrar sesión" del menú -- un simple <a href="/logout">, sin JavaScript de por medio. */
export async function GET(request: NextRequest) {
  await destruirCookieSesion();
  return NextResponse.redirect(new URL("/login", request.url));
}
