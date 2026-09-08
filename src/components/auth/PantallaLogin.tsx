"use client";

import { useState, type FormEvent } from "react";
import { iniciarSesionAction } from "../../app/login/actions";

export default function PantallaLogin() {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    // OJO: no envolver esta llamada en try/catch -- cuando el login sale
    // bien, la Server Action redirige (`redirect("/")`) internamente, y
    // eso funciona lanzando una señal especial que Next.js necesita ver
    // "limpia" para poder navegar. Cuando algo sale mal, la acción no
    // lanza nada -- simplemente devuelve { ok: false, mensaje }.
    const resultado = await iniciarSesionAction(usuario, password);
    setEnviando(false);
    if (resultado && !resultado.ok) {
      setError(resultado.mensaje ?? "No se pudo iniciar sesión.");
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "60px auto" }}>
      <div className="tarjeta">
        <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sistema Contable -- Colegios</h1>
        <p className="texto-suave" style={{ marginBottom: 20 }}>
          Inicia sesión con tu usuario y contraseña.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="campo">
            <label>Usuario</label>
            <input
              type="text"
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
          <div className="campo">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <p className="aviso aviso-error" style={{ marginBottom: 12 }}>
              {error}
            </p>
          )}
          <button type="submit" className="boton-primario" disabled={enviando} style={{ width: "100%" }}>
            {enviando ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
