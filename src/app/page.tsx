import Link from "next/link";
import { obtenerSesionActual } from "../lib/auth/sesion";
import { modulosPermitidosParaRol } from "../lib/auth/roles";

// El middleware ya garantiza que si llegamos hasta acá hay una sesión
// válida -- esta pantalla solo filtra el menú según el rol de quien entró.
export default async function InicioPage() {
  const sesion = await obtenerSesionActual();
  const modulos = sesion ? modulosPermitidosParaRol(sesion.rol) : [];

  return (
    <div>
      <h1>Sistema Contable -- Colegios</h1>
      <p className="subtitulo">
        {sesion ? `Bienvenido/a, ${sesion.nombreCompleto}.` : "Bienvenido/a."} Todos los reportes y nóminas se pueden
        descargar directamente en Excel.
      </p>
      <div className="grid-2">
        {modulos.map((m) => (
          <Link key={m.href} href={m.href} style={{ textDecoration: "none" }}>
            <div className="tarjeta">
              <h2>
                {m.emoji} {m.titulo}
              </h2>
              <p className="texto-suave">{m.descripcion}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
