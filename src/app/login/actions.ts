"use server";

import { redirect } from "next/navigation";
import { prisma } from "../../lib/prisma";
import { verificarPassword } from "../../lib/auth/password";
import { crearCookieSesion } from "../../lib/auth/sesion";
import type { RolUsuarioApp } from "../../lib/auth/sesion-nucleo";

export interface ResultadoLogin {
  ok: boolean;
  mensaje?: string;
}

/**
 * Valida usuario/contraseña contra la tabla `Usuario` y, si todo cuadra,
 * crea la cookie de sesión y manda al usuario a "/" (ahí ve el menú ya
 * filtrado según su rol). Mismo mensaje de error para "usuario no existe"
 * y "contraseña incorrecta" -- no hay que darle pistas a quien intenta
 * adivinar un usuario válido.
 */
export async function iniciarSesionAction(usuarioTexto: string, passwordTexto: string): Promise<ResultadoLogin> {
  const usuarioLimpio = usuarioTexto.trim().toLowerCase();
  if (!usuarioLimpio || !passwordTexto) {
    return { ok: false, mensaje: "Escribe tu usuario y tu contraseña." };
  }

  const usuario = await prisma.usuario.findUnique({ where: { usuario: usuarioLimpio } });
  if (!usuario || !usuario.activo) {
    return { ok: false, mensaje: "Usuario o contraseña incorrectos." };
  }

  const claveValida = await verificarPassword(passwordTexto, usuario.passwordHash);
  if (!claveValida) {
    return { ok: false, mensaje: "Usuario o contraseña incorrectos." };
  }

  await crearCookieSesion({
    usuarioId: usuario.id,
    usuario: usuario.usuario,
    nombreCompleto: usuario.nombreCompleto,
    rol: usuario.rol as RolUsuarioApp,
  });

  redirect("/");
}
