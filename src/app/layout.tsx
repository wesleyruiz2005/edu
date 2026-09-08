import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { obtenerSesionActual } from "../lib/auth/sesion";
import { modulosPermitidosParaRol, nombreRol } from "../lib/auth/roles";

export const metadata: Metadata = {
  title: "Sistema Contable -- Colegios",
  description: "Sistema contable y de cobranza multi-sede (El Mesías, El Buen Pastor, Instituto Tecnológico)",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sesion = await obtenerSesionActual();
  const modulos = sesion ? modulosPermitidosParaRol(sesion.rol) : [];

  return (
    <html lang="es">
      <body>
        <header className="app-header">
          <strong>Sistema Contable -- Colegios</strong>
          {sesion && (
            <nav>
              <Link href="/">Inicio</Link>
              {modulos.map((m) => (
                <Link key={m.href} href={m.href}>
                  {m.tituloCorto}
                </Link>
              ))}
            </nav>
          )}
          {sesion && (
            <span style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto", fontSize: 13 }}>
              <span className="texto-suave">
                {sesion.nombreCompleto} -- {nombreRol(sesion.rol)}
              </span>
              <a href="/logout">Cerrar sesión</a>
            </span>
          )}
        </header>
        <main className="app-shell">{children}</main>
      </body>
    </html>
  );
}
