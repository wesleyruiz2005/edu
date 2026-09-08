/**
 * ============================================================================
 * NÚCLEO DE SESIÓN (firma y verificación) -- SIN dependencias de Next.js
 * ============================================================================
 * Este archivo es a propósito "puro": no importa `next/headers` ni
 * `@prisma/client`. La razón es que `src/middleware.ts` corre en el runtime
 * "Edge" de Next.js (no es Node.js completo) y ahí NO se puede usar
 * `@prisma/client` ni las cookies de `next/headers` -- solo Web APIs
 * estándar (`crypto.subtle`, `TextEncoder`, `atob`/`btoa`), que sí están
 * disponibles tanto en Edge como en Node 20+. Por eso el rol del usuario se
 * representa aquí como un simple string ("CAJERA" | "CONTADOR" |
 * "JUNTA_DIRECTIVA") en vez de importar el enum `RolUsuario` generado por
 * Prisma -- el valor es el mismo texto, así que en el resto del sistema
 * (que sí corre en Node.js normal) se puede usar sin conversión.
 *
 * La sesión es una cookie firmada con HMAC-SHA256 (usando `AUTH_SECRET` de
 * `.env`): `<payload en Base64>.<firma en Base64>`. No es un JWT de
 * librería externa para no agregar una dependencia más -- es la misma idea,
 * hecha a mano con las Web Crypto APIs.
 */

export type RolUsuarioApp = "CAJERA" | "CONTADOR" | "JUNTA_DIRECTIVA";

export const NOMBRE_COOKIE_SESION = "sesion_contable";
/** 8 horas -- una jornada laboral. */
export const DURACION_SESION_SEG = 60 * 60 * 8;

export interface DatosSesion {
  usuarioId: number;
  usuario: string;
  nombreCompleto: string;
  rol: RolUsuarioApp;
  /** Vencimiento, en segundos desde epoch (Unix time). */
  exp: number;
}

function obtenerSecreto(): string {
  const secreto = process.env.AUTH_SECRET;
  if (secreto && secreto.trim().length >= 16) return secreto;
  // Clave de respaldo SOLO para que el sistema arranque en una prueba local
  // si a alguien se le olvida definir AUTH_SECRET en ".env" -- para un uso
  // real (no solo la prueba de mañana) hay que definir una propia y secreta.
  return "clave-de-desarrollo-sistema-contable-colegios-2026-no-usar-en-produccion";
}

async function obtenerClaveHmac(): Promise<CryptoKey> {
  const codificador = new TextEncoder();
  return crypto.subtle.importKey("raw", codificador.encode(obtenerSecreto()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function base64UrlCodificar(bytes: Uint8Array): string {
  let binario = "";
  for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodificar(texto: string): Uint8Array {
  const relleno = texto.length % 4 === 0 ? "" : "=".repeat(4 - (texto.length % 4));
  const base64 = texto.replace(/-/g, "+").replace(/_/g, "/") + relleno;
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** Firma el payload de sesión y devuelve el valor completo listo para guardar en la cookie. */
export async function firmarSesion(datos: DatosSesion): Promise<string> {
  const clave = await obtenerClaveHmac();
  const payloadBase64 = base64UrlCodificar(new TextEncoder().encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(payloadBase64));
  const firmaBase64 = base64UrlCodificar(new Uint8Array(firma));
  return `${payloadBase64}.${firmaBase64}`;
}

/**
 * Verifica la firma y el vencimiento de una cookie de sesión.
 * Devuelve `null` si no existe, está corrupta, mal firmada o vencida --
 * nunca lanza una excepción (así el middleware y las pantallas solo tienen
 * que revisar "¿hay sesión o no?").
 */
export async function verificarSesion(valorCookie: string | undefined | null): Promise<DatosSesion | null> {
  if (!valorCookie) return null;
  const separador = valorCookie.indexOf(".");
  if (separador < 1) return null;
  const payloadBase64 = valorCookie.slice(0, separador);
  const firmaBase64 = valorCookie.slice(separador + 1);
  if (!payloadBase64 || !firmaBase64) return null;

  try {
    const clave = await obtenerClaveHmac();
    const firmaValida = await crypto.subtle.verify(
      "HMAC",
      clave,
      base64UrlDecodificar(firmaBase64) as BufferSource,
      new TextEncoder().encode(payloadBase64)
    );
    if (!firmaValida) return null;

    const datos = JSON.parse(new TextDecoder().decode(base64UrlDecodificar(payloadBase64))) as DatosSesion;
    if (typeof datos.exp !== "number" || datos.exp < Math.floor(Date.now() / 1000)) return null; // vencida
    return datos;
  } catch {
    return null; // cookie corrupta o manipulada -- se trata igual que "no hay sesión"
  }
}
