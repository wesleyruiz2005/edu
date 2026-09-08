"use client";

/**
 * Botón reutilizable de "Descargar Excel" -- lo usan TODAS las pantallas que
 * necesitan el requisito transversal de Eduardo (nómina, retenciones DGI,
 * estados financieros, dashboard de la Junta, etc.). Recibe una Server
 * Action que devuelve `{ ok, base64, nombreArchivo }` (ver
 * `src/lib/exportar/excel.ts`) y arma la descarga en el navegador --
 * ningún componente necesita saber cómo se arma el .xlsx por dentro.
 */
import { useState } from "react";

export interface ResultadoDescarga {
  ok: boolean;
  mensaje?: string;
  base64?: string;
  nombreArchivo?: string;
}

interface Props {
  etiqueta: string;
  accion: () => Promise<ResultadoDescarga>;
  className?: string;
  disabled?: boolean;
}

function base64ABlob(base64: string): Blob {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export default function BotonDescargarExcel({ etiqueta, accion, className, disabled }: Props) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setCargando(true);
    setError(null);
    try {
      const r = await accion();
      if (!r.ok || !r.base64 || !r.nombreArchivo) {
        setError(r.mensaje ?? "No se pudo generar el archivo Excel.");
        return;
      }
      const blob = base64ABlob(r.base64);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nombreArchivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error inesperado generando el Excel.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className={className ?? "boton-secundario"} onClick={handleClick} disabled={cargando || disabled}>
        {cargando ? "Generando..." : `⬇ ${etiqueta}`}
      </button>
      {error && (
        <span className="texto-suave" style={{ color: "var(--color-peligro)", fontSize: 12 }}>
          {error}
        </span>
      )}
    </span>
  );
}
