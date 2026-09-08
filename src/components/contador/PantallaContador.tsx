"use client";

import { useEffect, useState } from "react";
import {
  obtenerLibroDiarioAction,
  exportarLibroDiarioAction,
  obtenerLibroMayorAction,
  exportarLibroMayorAction,
  listarCierresMensualesAction,
  cerrarMesAction,
  reabrirMesAction,
  cerrarAnioAction,
  type CierreMensualEstado,
} from "../../app/contador/actions";
import type { AsientoLibroDiario } from "../../lib/reportes/libro-diario";
import type { LibroMayorCuenta } from "../../lib/reportes/libro-mayor";
import BotonDescargarExcel from "../shared/BotonDescargarExcel";

interface Colegio {
  id: number;
  codigo: string;
  nombre: string;
}

interface Props {
  colegios: Colegio[];
}

const MESES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

type Pestana = "diario" | "mayor" | "cierres";

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PantallaContador({ colegios }: Props) {
  const hoy = new Date();
  const [pestana, setPestana] = useState<Pestana>("diario");
  const [colegioId, setColegioId] = useState<number | "">(colegios[0]?.id ?? "");
  const [anio, setAnio] = useState(hoy.getFullYear());

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={pestana === "diario" ? "boton-primario" : "boton-secundario"} onClick={() => setPestana("diario")}>
          Libro Diario
        </button>
        <button className={pestana === "mayor" ? "boton-primario" : "boton-secundario"} onClick={() => setPestana("mayor")}>
          Libro Mayor
        </button>
        <button className={pestana === "cierres" ? "boton-primario" : "boton-secundario"} onClick={() => setPestana("cierres")}>
          Cierres Mensuales/Anuales
        </button>
      </div>

      <div className="tarjeta" style={{ marginBottom: 16 }}>
        <div className="grid-2">
          <div className="campo">
            <label>Sede</label>
            <select value={colegioId} onChange={(e) => setColegioId(Number(e.target.value))}>
              {colegios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
          </div>
        </div>
      </div>

      {pestana === "diario" && colegioId !== "" && <SeccionLibroDiario colegioId={colegioId} anio={anio} />}
      {pestana === "mayor" && colegioId !== "" && <SeccionLibroMayor colegioId={colegioId} anio={anio} />}
      {pestana === "cierres" && colegioId !== "" && <SeccionCierres colegioId={colegioId} anio={anio} />}
    </div>
  );
}

function SeccionLibroDiario({ colegioId, anio }: { colegioId: number; anio: number }) {
  const [mes, setMes] = useState<number | "">("");
  const [asientos, setAsientos] = useState<AsientoLibroDiario[]>([]);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const r = await obtenerLibroDiarioAction(colegioId, anio, mes === "" ? undefined : mes);
      setAsientos(r);
    } finally {
      setCargando(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    cargar();
  }, [colegioId, anio, mes]);

  return (
    <div className="tarjeta">
      <div className="campo" style={{ maxWidth: 260 }}>
        <label>Mes (vacío = todo el año)</label>
        <select value={mes} onChange={(e) => setMes(e.target.value === "" ? "" : Number(e.target.value))}>
          <option value="">-- Año completo --</option>
          {MESES.slice(1).map((m, i) => (
            <option key={i + 1} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <BotonDescargarExcel
        etiqueta="Descargar Libro Diario en Excel"
        className="boton-primario"
        accion={() => exportarLibroDiarioAction(colegioId, anio, mes === "" ? undefined : mes)}
      />

      {cargando && <p className="texto-suave">Cargando...</p>}
      {!cargando && asientos.length === 0 && <p className="texto-suave">No hay comprobantes registrados en este periodo.</p>}
      {!cargando && asientos.length > 0 && (
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Comprobante</th>
              <th>Concepto</th>
              <th>Beneficiario</th>
              <th>Débito</th>
              <th>Crédito</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {asientos.map((a) => (
              <tr key={a.comprobanteId.toString()}>
                <td>{a.fecha.toString().slice(0, 10)}</td>
                <td>{a.claveComprobante}</td>
                <td>{a.concepto || "--"}</td>
                <td>{a.beneficiario || "--"}</td>
                <td className="monto">C${formatoMonto(a.totalDebito)}</td>
                <td className="monto">C${formatoMonto(a.totalCredito)}</td>
                <td>
                  <span className={a.estado === "CUADRADO" ? "badge badge-al-dia" : "badge badge-vencido"}>{a.estadoTexto}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SeccionLibroMayor({ colegioId, anio }: { colegioId: number; anio: number }) {
  const [cuentaCodigo, setCuentaCodigo] = useState("");
  const [mesDesde, setMesDesde] = useState(1);
  const [mesHasta, setMesHasta] = useState(12);
  const [mayor, setMayor] = useState<LibroMayorCuenta | null>(null);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    if (!cuentaCodigo.trim()) {
      setMayor(null);
      return;
    }
    setCargando(true);
    try {
      const r = await obtenerLibroMayorAction(colegioId, cuentaCodigo, anio, mesDesde, mesHasta);
      setMayor(r);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="tarjeta">
      <div className="grid-2">
        <div className="campo">
          <label>Código de cuenta (ej. 110101)</label>
          <input type="text" value={cuentaCodigo} onChange={(e) => setCuentaCodigo(e.target.value)} placeholder="110101" />
        </div>
        <div className="campo">
          <label>Mes desde -- hasta</label>
          <div style={{ display: "flex", gap: 8 }}>
            <select value={mesDesde} onChange={(e) => setMesDesde(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <select value={mesHasta} onChange={(e) => setMesHasta(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="boton-secundario" onClick={cargar} disabled={!cuentaCodigo.trim() || cargando}>
          {cargando ? "Consultando..." : "Consultar cuenta"}
        </button>
        <BotonDescargarExcel
          etiqueta="Descargar Libro Mayor en Excel"
          className="boton-primario"
          accion={() => exportarLibroMayorAction(colegioId, cuentaCodigo, anio, mesDesde, mesHasta)}
          disabled={!cuentaCodigo.trim()}
        />
      </div>

      {mayor && (
        <>
          <h2 style={{ marginTop: 16 }}>
            {mayor.cuentaCodigo} -- {mayor.cuentaNombre}
          </h2>
          <div className="tarjetas-resumen">
            <div className="resumen-item">
              <div className="texto-suave">Saldo inicial</div>
              <div className="valor">C${formatoMonto(mayor.saldoInicial)}</div>
            </div>
            <div className="resumen-item">
              <div className="texto-suave">Total débito</div>
              <div className="valor">C${formatoMonto(mayor.totalDebito)}</div>
            </div>
            <div className="resumen-item">
              <div className="texto-suave">Total crédito</div>
              <div className="valor">C${formatoMonto(mayor.totalCredito)}</div>
            </div>
            <div className="resumen-item acento-primario">
              <div className="texto-suave">Saldo final</div>
              <div className="valor">C${formatoMonto(mayor.saldoFinal)}</div>
            </div>
          </div>
          {mayor.movimientos.length === 0 ? (
            <p className="texto-suave">Sin movimientos en el periodo.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Comprobante</th>
                  <th>Concepto</th>
                  <th>Débito</th>
                  <th>Crédito</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {mayor.movimientos.map((m, i) => (
                  <tr key={i}>
                    <td>{m.fecha.toString().slice(0, 10)}</td>
                    <td>{m.claveComprobante}</td>
                    <td>{m.concepto || "--"}</td>
                    <td className="monto">C${formatoMonto(m.debitoC)}</td>
                    <td className="monto">C${formatoMonto(m.creditoC)}</td>
                    <td className="monto">C${formatoMonto(m.saldoAcumulado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function SeccionCierres({ colegioId, anio }: { colegioId: number; anio: number }) {
  const [cierres, setCierres] = useState<CierreMensualEstado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [procesandoMes, setProcesandoMes] = useState<number | null>(null);
  const [procesandoAnio, setProcesandoAnio] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);

  async function cargar() {
    setCargando(true);
    try {
      const r = await listarCierresMensualesAction(colegioId, anio);
      setCierres(r);
    } finally {
      setCargando(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    cargar();
    setAviso(null);
  }, [colegioId, anio]);

  async function handleCerrarMes(mes: number) {
    setProcesandoMes(mes);
    setAviso(null);
    const r = await cerrarMesAction(colegioId, anio, mes, "Contador (prueba local)");
    setProcesandoMes(null);
    if (r.ok && r.resultado) {
      setAviso({
        tipo: "exito",
        texto: `Mes ${MESES[mes]} cerrado. Utilidad neta: C$${formatoMonto(r.resultado.utilidadNeta)} -- ${
          r.resultado.balanceCuadrado ? "Balance General OK - Cuadrado." : "OJO: el Balance General no cuadró."
        }`,
      });
      await cargar();
    } else {
      setAviso({ tipo: "error", texto: r.mensaje ?? "No se pudo cerrar el mes." });
    }
  }

  async function handleReabrirMes(mes: number) {
    setProcesandoMes(mes);
    setAviso(null);
    const r = await reabrirMesAction(colegioId, anio, mes);
    setProcesandoMes(null);
    if (r.ok) {
      setAviso({ tipo: "exito", texto: `Mes ${MESES[mes]} reabierto -- ya se pueden registrar/corregir comprobantes ahí.` });
      await cargar();
    } else {
      setAviso({ tipo: "error", texto: r.mensaje ?? "No se pudo reabrir el mes." });
    }
  }

  async function handleCerrarAnio() {
    setProcesandoAnio(true);
    setAviso(null);
    const r = await cerrarAnioAction(colegioId, anio, "Contador (prueba local)");
    setProcesandoAnio(false);
    if (r.ok && r.resultado) {
      setAviso({
        tipo: "exito",
        texto: `Año ${anio} cerrado. Utilidad del ejercicio: C$${formatoMonto(r.resultado.utilidadEjercicio)}${
          r.resultado.claveComprobante ? ` (comprobante ${r.resultado.claveComprobante})` : ""
        }.`,
      });
    } else {
      setAviso({ tipo: "error", texto: r.mensaje ?? "No se pudo cerrar el año." });
    }
  }

  const todosCerrados = cierres.length === 12 && cierres.every((c) => c.estado === "CERRADO");

  return (
    <div className="tarjeta">
      {aviso && <p className={aviso.tipo === "exito" ? "aviso aviso-exito" : "aviso aviso-error"}>{aviso.texto}</p>}

      {cargando ? (
        <p className="texto-suave">Cargando...</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th>Estado</th>
              <th>Fecha de cierre</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {cierres.map((c) => (
              <tr key={c.mes}>
                <td>{MESES[c.mes]}</td>
                <td>
                  <span className={c.estado === "CERRADO" ? "badge badge-al-dia" : "badge badge-vencido"}>
                    {c.estado === "CERRADO" ? "Cerrado" : "Abierto"}
                  </span>
                </td>
                <td>{c.fechaCierre ?? "--"}</td>
                <td>
                  {c.estado === "ABIERTO" ? (
                    <button className="boton-secundario" disabled={procesandoMes === c.mes} onClick={() => handleCerrarMes(c.mes)}>
                      {procesandoMes === c.mes ? "Cerrando..." : "Cerrar mes"}
                    </button>
                  ) : (
                    <button className="boton-texto" disabled={procesandoMes === c.mes} onClick={() => handleReabrirMes(c.mes)}>
                      {procesandoMes === c.mes ? "Reabriendo..." : "Reabrir"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--color-borde)" }}>
        <p className="texto-suave" style={{ marginBottom: 8 }}>
          El cierre anual necesita los 12 meses de {anio} ya cerrados. Cancela contra la cuenta &quot;34 Excedente Del
          Ejercicio&quot; la utilidad o pérdida del año.
        </p>
        <button className="boton-primario" disabled={!todosCerrados || procesandoAnio} onClick={handleCerrarAnio}>
          {procesandoAnio ? "Cerrando el año..." : `Cerrar año ${anio}`}
        </button>
        {!todosCerrados && <p className="texto-suave" style={{ marginTop: 6 }}>(deshabilitado hasta cerrar los 12 meses)</p>}
      </div>
    </div>
  );
}
