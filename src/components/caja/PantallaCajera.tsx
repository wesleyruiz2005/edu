"use client";

import { useMemo, useState } from "react";
import {
  buscarEstudianteAction,
  emitirRocAction,
  generarMensajeWhatsappAction,
  type EmitirRocResultado,
  type LineaCajeraEntrada,
  type OpcionCuentaIngreso,
} from "../../app/caja/actions";
import type { EstadoCuentaEstudiante } from "../../lib/reportes/estado-cuenta";

interface Colegio {
  id: number;
  codigo: string;
  nombre: string;
}

interface Props {
  colegios: Colegio[];
  cuentasIngreso: OpcionCuentaIngreso[];
}

interface OtraLinea {
  key: string;
  cuentaContableCodigo: string;
  descripcion: string;
  monto: string;
}

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatoFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-NI", { year: "numeric", month: "short", day: "2-digit" });
}

export default function PantallaCajera({ colegios, cuentasIngreso }: Props) {
  const [colegioId, setColegioId] = useState<number>(colegios[0]?.id ?? 0);
  const [codigo, setCodigo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const [estudiante, setEstudiante] = useState<EstadoCuentaEstudiante | null>(null);

  const [seleccionCargos, setSeleccionCargos] = useState<Record<string, string>>({}); // cargoId -> monto (texto del input)
  const [otrasLineas, setOtrasLineas] = useState<OtraLinea[]>([]);
  const [formaPago, setFormaPago] = useState<"EFECTIVO" | "TRANSFERENCIA" | "TARJETA">("EFECTIVO");
  const [observacion, setObservacion] = useState("");
  const [creadoPor, setCreadoPor] = useState("");

  const [emitiendo, setEmitiendo] = useState(false);
  const [resultado, setResultado] = useState<EmitirRocResultado | null>(null);

  const [generandoWhatsapp, setGenerandoWhatsapp] = useState(false);
  const [avisoWhatsapp, setAvisoWhatsapp] = useState<string | null>(null);

  async function handleBuscar() {
    setBuscando(true);
    setErrorBusqueda(null);
    setResultado(null);
    try {
      const r = await buscarEstudianteAction(colegioId, codigo);
      if (!r.ok || !r.estudiante) {
        setEstudiante(null);
        setErrorBusqueda(r.mensaje ?? "No se encontró el alumno.");
        return;
      }
      setEstudiante(r.estudiante);
      setSeleccionCargos({});
      setOtrasLineas([]);
    } finally {
      setBuscando(false);
    }
  }

  function toggleCargo(cargoId: string, saldoPendiente: number, marcado: boolean) {
    setSeleccionCargos((prev) => {
      const copia = { ...prev };
      if (marcado) copia[cargoId] = saldoPendiente.toFixed(2);
      else delete copia[cargoId];
      return copia;
    });
  }

  function cambiarMontoCargo(cargoId: string, valor: string) {
    setSeleccionCargos((prev) => ({ ...prev, [cargoId]: valor }));
  }

  function agregarOtraLinea() {
    setOtrasLineas((prev) => [
      ...prev,
      { key: `${Date.now()}-${prev.length}`, cuentaContableCodigo: cuentasIngreso[0]?.codigo ?? "", descripcion: "", monto: "" },
    ]);
  }

  function actualizarOtraLinea(key: string, campo: keyof OtraLinea, valor: string) {
    setOtrasLineas((prev) => prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l)));
  }

  function quitarOtraLinea(key: string) {
    setOtrasLineas((prev) => prev.filter((l) => l.key !== key));
  }

  const totalACobrar = useMemo(() => {
    const totalCargos = Object.values(seleccionCargos).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    const totalOtros = otrasLineas.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0);
    return Math.round((totalCargos + totalOtros + Number.EPSILON) * 100) / 100;
  }, [seleccionCargos, otrasLineas]);

  async function handleEmitirRoc() {
    if (!estudiante && otrasLineas.length === 0) return;

    const lineas: LineaCajeraEntrada[] = [];
    for (const [cargoId, montoTexto] of Object.entries(seleccionCargos)) {
      const monto = parseFloat(montoTexto);
      if (monto > 0) lineas.push({ tipo: "ARANCEL_ACTUAL", cargoEstudianteId: cargoId, monto });
    }
    for (const l of otrasLineas) {
      const monto = parseFloat(l.monto);
      if (monto > 0 && l.cuentaContableCodigo) {
        lineas.push({
          tipo: "OTRO_INGRESO",
          descripcion: l.descripcion || "Otro ingreso",
          cuentaContableCodigo: l.cuentaContableCodigo,
          monto,
          estudianteId: estudiante?.estudianteId,
        });
      }
    }
    if (lineas.length === 0) return;

    setEmitiendo(true);
    setResultado(null);
    try {
      const r = await emitirRocAction({
        colegioId,
        estudianteId: estudiante?.estudianteId,
        formaPago,
        observacion: observacion || undefined,
        creadoPor: creadoPor || undefined,
        lineas,
      });
      setResultado(r);
      if (r.ok) {
        // Refresca el estado de cuenta del alumno (los saldos ya cambiaron) y limpia el carrito.
        setSeleccionCargos({});
        setOtrasLineas([]);
        if (estudiante) {
          const refrescado = await buscarEstudianteAction(colegioId, estudiante.codigoEstudiantil);
          if (refrescado.ok && refrescado.estudiante) setEstudiante(refrescado.estudiante);
        }
      }
    } finally {
      setEmitiendo(false);
    }
  }

  async function handleEnviarWhatsapp() {
    if (!estudiante) return;
    setGenerandoWhatsapp(true);
    setAvisoWhatsapp(null);
    try {
      const r = await generarMensajeWhatsappAction(estudiante.estudianteId);
      if (!r.ok) {
        setAvisoWhatsapp(r.mensaje ?? "No se pudo generar el mensaje de cobranza.");
        return;
      }
      if (r.linkWhatsapp) {
        window.open(r.linkWhatsapp, "_blank");
      } else {
        setAvisoWhatsapp(
          "Este alumno no tiene teléfono de tutor registrado -- copia el mensaje generado a mano:\n\n" + (r.mensajeTexto ?? "")
        );
      }
    } finally {
      setGenerandoWhatsapp(false);
    }
  }

  return (
    <div>
      <div className="tarjeta">
        <h2>1. Buscar alumno</h2>
        <div className="grid-2">
          <div className="campo">
            <label>Colegio</label>
            <select value={colegioId} onChange={(e) => setColegioId(Number(e.target.value))}>
              {colegios.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label>Código NC / Código del alumno</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleBuscar()}
                placeholder="ej. CMLM-2026-001, ITML-2026-035"
              />
              <button className="boton-primario" onClick={handleBuscar} disabled={buscando}>
                {buscando ? "Buscando..." : "Buscar"}
              </button>
            </div>
          </div>
        </div>
        {errorBusqueda && <div className="aviso aviso-error">{errorBusqueda}</div>}
      </div>

      {estudiante && (
        <>
          <div className="tarjeta">
            <h2>
              {estudiante.nombreCompleto} <span className="texto-suave">({estudiante.codigoEstudiantil})</span>
            </h2>
            <p className="texto-suave" style={{ margin: "0 0 12px" }}>
              {estudiante.nivelAcademico}
              {estudiante.seccion ? ` -- Sección ${estudiante.seccion}` : ""} · Tutor: {estudiante.nombreTutor}
              {estudiante.codigoIccm ? ` · ICCM: ${estudiante.codigoIccm}` : ""}
            </p>

            {estudiante.saldoVencido > 0 && (
              <div className="aviso aviso-alerta">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span>
                    ⚠ Este alumno tiene <strong>C${formatoMonto(estudiante.saldoVencido)}</strong> vencidos en{" "}
                    {estudiante.mesesVencidos} cargo(s). Revisa el detalle abajo antes de cobrar.
                  </span>
                  <button className="boton-secundario" onClick={handleEnviarWhatsapp} disabled={generandoWhatsapp} title="Enviar recordatorio de cobro por WhatsApp al tutor">
                    {generandoWhatsapp ? "Generando..." : "💬 WhatsApp al tutor"}
                  </button>
                </div>
              </div>
            )}
            {avisoWhatsapp && (
              <div className="aviso aviso-alerta" style={{ whiteSpace: "pre-wrap" }}>
                {avisoWhatsapp}
              </div>
            )}

            <div className="tarjetas-resumen">
              <div className="resumen-item">
                <div className="texto-suave">Saldo pendiente total</div>
                <div className="valor">C${formatoMonto(estudiante.saldoTotalPendiente)}</div>
              </div>
              <div className="resumen-item acento-peligro">
                <div className="texto-suave">Saldo vencido</div>
                <div className="valor">C${formatoMonto(estudiante.saldoVencido)}</div>
              </div>
              <div className="resumen-item acento-primario">
                <div className="texto-suave">A cobrar en este recibo</div>
                <div className="valor">C${formatoMonto(totalACobrar)}</div>
              </div>
            </div>
          </div>

          <div className="tarjeta">
            <h2>2. Aranceles pendientes (Matrícula, Mensualidad, Papelería, Décimo Tercero...)</h2>
            {estudiante.cargosPendientes.length === 0 ? (
              <p className="texto-suave">Este alumno no tiene ningún cargo pendiente -- está al día.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Concepto</th>
                    <th>Año / Mes</th>
                    <th>Vencimiento</th>
                    <th>Facturado</th>
                    <th>Recargo mora</th>
                    <th>Saldo pendiente</th>
                    <th>Monto a cobrar</th>
                  </tr>
                </thead>
                <tbody>
                  {estudiante.cargosPendientes.map((c) => {
                    const marcado = c.cargoId in seleccionCargos;
                    return (
                      <tr key={c.cargoId}>
                        <td>
                          <input
                            type="checkbox"
                            checked={marcado}
                            onChange={(e) => toggleCargo(c.cargoId, c.saldoPendiente, e.target.checked)}
                          />
                        </td>
                        <td>{c.concepto}</td>
                        <td>
                          {c.anioLectivo}
                          {c.mes ? ` / ${String(c.mes).padStart(2, "0")}` : ""}
                        </td>
                        <td>
                          {formatoFecha(c.fechaVencimiento)}{" "}
                          {c.vencido ? <span className="badge badge-vencido">VENCIDO</span> : <span className="badge badge-al-dia">al día</span>}
                        </td>
                        <td className="monto">C${formatoMonto(c.montoFacturado)}</td>
                        <td className="monto">{c.recargoMoraMonto > 0 ? `C$${formatoMonto(c.recargoMoraMonto)}` : "--"}</td>
                        <td className="monto">C${formatoMonto(c.saldoPendiente)}</td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            max={c.saldoPendiente}
                            step="0.01"
                            disabled={!marcado}
                            value={seleccionCargos[c.cargoId] ?? ""}
                            onChange={(e) => cambiarMontoCargo(c.cargoId, e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {estudiante.cargosPendientes.some((c) => c.vencido) && (
              <p className="texto-suave" style={{ marginTop: 10 }}>
                Nota: si un mes vencido todavía no tiene el 10% de recargo aplicado, el sistema se lo calcula
                automáticamente en el momento de emitir el ROC (no hace falta esperar al proceso nocturno de mora).
              </p>
            )}
          </div>
        </>
      )}

      {(estudiante || otrasLineas.length > 0) && (
        <div className="tarjeta">
          <h2>3. Uniformes, certificados y otros cobros</h2>
          {otrasLineas.map((l) => (
            <div key={l.key} className="grid-2" style={{ marginBottom: 10, alignItems: "end" }}>
              <div className="campo" style={{ marginBottom: 0 }}>
                <label>Cuenta contable</label>
                <select value={l.cuentaContableCodigo} onChange={(e) => actualizarOtraLinea(l.key, "cuentaContableCodigo", e.target.value)}>
                  {cuentasIngreso.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.codigo} -- {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
                <div className="campo" style={{ marginBottom: 0, flex: 2 }}>
                  <label>Descripción</label>
                  <input
                    type="text"
                    value={l.descripcion}
                    onChange={(e) => actualizarOtraLinea(l.key, "descripcion", e.target.value)}
                    placeholder="ej. Uniforme talla 8, Certificado de Notas"
                  />
                </div>
                <div className="campo" style={{ marginBottom: 0, flex: 1 }}>
                  <label>Monto</label>
                  <input type="number" min={0} step="0.01" value={l.monto} onChange={(e) => actualizarOtraLinea(l.key, "monto", e.target.value)} />
                </div>
                <button className="boton-texto" onClick={() => quitarOtraLinea(l.key)} title="Quitar línea">
                  ✕
                </button>
              </div>
            </div>
          ))}
          <button className="boton-secundario" onClick={agregarOtraLinea} disabled={cuentasIngreso.length === 0}>
            + Agregar línea
          </button>
          {cuentasIngreso.length === 0 && (
            <p className="texto-suave" style={{ marginTop: 8 }}>
              No hay cuentas de Ingreso DETALLE configuradas en el catálogo todavía.
            </p>
          )}
        </div>
      )}

      {(estudiante || otrasLineas.length > 0) && (
        <div className="tarjeta">
          <h2>4. Emitir ROC</h2>
          <div className="grid-2">
            <div className="campo">
              <label>Forma de pago</label>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value as typeof formaPago)}>
                <option value="EFECTIVO">Efectivo</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="TARJETA">Tarjeta</option>
              </select>
            </div>
            <div className="campo">
              <label>Cajera (opcional)</label>
              <input type="text" value={creadoPor} onChange={(e) => setCreadoPor(e.target.value)} placeholder="Nombre de quien cobra" />
            </div>
          </div>
          <div className="campo">
            <label>Observación (opcional)</label>
            <textarea rows={2} value={observacion} onChange={(e) => setObservacion(e.target.value)} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <div>
              Total a cobrar: <span className="monto" style={{ fontSize: 18 }}>C${formatoMonto(totalACobrar)}</span>
            </div>
            <button className="boton-primario" onClick={handleEmitirRoc} disabled={emitiendo || totalACobrar <= 0}>
              {emitiendo ? "Emitiendo..." : "Emitir ROC"}
            </button>
          </div>

          {resultado && (
            <div className={`aviso ${resultado.ok ? "aviso-exito" : "aviso-error"}`} style={{ marginTop: 14 }}>
              {resultado.ok ? (
                <>
                  ✅ ROC <strong>{resultado.numeroRoc}</strong> emitido por C${formatoMonto(resultado.montoTotalCobrado ?? 0)}.
                  {resultado.comprobantes && resultado.comprobantes.length > 0 && (
                    <> Comprobante(s): {resultado.comprobantes.map((c) => `${c.claveComprobante} (${c.libro})`).join(", ")}.</>
                  )}
                  {resultado.alertas && resultado.alertas.length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                      {resultado.alertas.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>❌ {resultado.mensaje}</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
