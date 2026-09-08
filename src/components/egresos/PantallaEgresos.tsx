"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buscarProveedoresAction,
  obtenerHistorialProveedorAction,
  calcularVistaPreviaRetencionAction,
  registrarPagoAction,
  type OpcionProveedor,
  type OpcionCuentaGasto,
  type OpcionCuentaOrigen,
  type HistorialProveedorResultado,
  type VistaPreviaRetencion,
  type RegistrarPagoResultado,
} from "../../app/egresos/actions";
import type { TipoGastoRetencion } from "../../lib/pagos/retencion";

interface Colegio {
  id: number;
  codigo: string;
  nombre: string;
}

interface Props {
  colegios: Colegio[];
  cuentasGasto: OpcionCuentaGasto[];
  cuentasOrigen: OpcionCuentaOrigen[];
}

interface LineaGasto {
  key: string;
  cuentaGastoCodigo: string;
  monto: string;
  descripcion: string;
}

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PantallaEgresos({ colegios, cuentasGasto, cuentasOrigen }: Props) {
  const [colegioId, setColegioId] = useState<number>(colegios[0]?.id ?? 0);

  const [textoProveedor, setTextoProveedor] = useState("");
  const [proveedores, setProveedores] = useState<OpcionProveedor[]>([]);
  const [buscandoProveedor, setBuscandoProveedor] = useState(false);
  const [proveedor, setProveedor] = useState<OpcionProveedor | null>(null);
  const [historial, setHistorial] = useState<HistorialProveedorResultado | null>(null);

  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [formaPago, setFormaPago] = useState<"CAJA_GENERAL" | "TRANSFERENCIA" | "CHEQUE">("CAJA_GENERAL");
  const [cuentaOrigenCodigo, setCuentaOrigenCodigo] = useState(cuentasOrigen[0]?.codigo ?? "");
  const [numeroCheque, setNumeroCheque] = useState("");
  const [numeroFactura, setNumeroFactura] = useState("");
  const [conceptoPago, setConceptoPago] = useState("");
  const [tipoGasto, setTipoGasto] = useState<TipoGastoRetencion>("COMPRA_O_SERVICIO_GENERAL");
  const [montoFactura, setMontoFactura] = useState("");
  const [baseImponibleSinIva, setBaseImponibleSinIva] = useState("");
  const [detalleGastos, setDetalleGastos] = useState<LineaGasto[]>([
    { key: "1", cuentaGastoCodigo: cuentasGasto[0]?.codigo ?? "", monto: "", descripcion: "" },
  ]);

  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaRetencion | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [resultado, setResultado] = useState<RegistrarPagoResultado | null>(null);

  async function handleBuscarProveedor() {
    setBuscandoProveedor(true);
    try {
      const r = await buscarProveedoresAction(colegioId, textoProveedor);
      setProveedores(r);
    } finally {
      setBuscandoProveedor(false);
    }
  }

  async function seleccionarProveedor(p: OpcionProveedor) {
    setProveedor(p);
    setProveedores([]);
    setResultado(null);
    const h = await obtenerHistorialProveedorAction(p.id, fechaPago);
    setHistorial(h);
  }

  // Recalcula la retención EN VIVO cada vez que cambia algo que la afecta.
  useEffect(() => {
    if (!proveedor) {
      setVistaPrevia(null);
      return;
    }
    const monto = parseFloat(montoFactura);
    if (!monto || monto <= 0) {
      setVistaPrevia(null);
      return;
    }
    let cancelado = false;
    calcularVistaPreviaRetencionAction({
      proveedorId: proveedor.id,
      tipoGasto,
      montoFactura: monto,
      baseImponibleSinIva: baseImponibleSinIva ? parseFloat(baseImponibleSinIva) : undefined,
      fechaPago,
    }).then((r) => {
      if (!cancelado) setVistaPrevia(r);
    });
    return () => {
      cancelado = true;
    };
  }, [proveedor, tipoGasto, montoFactura, baseImponibleSinIva, fechaPago]);

  function agregarLineaGasto() {
    setDetalleGastos((prev) => [
      ...prev,
      { key: `${Date.now()}`, cuentaGastoCodigo: cuentasGasto[0]?.codigo ?? "", monto: "", descripcion: "" },
    ]);
  }

  function actualizarLineaGasto(key: string, campo: keyof LineaGasto, valor: string) {
    setDetalleGastos((prev) => prev.map((l) => (l.key === key ? { ...l, [campo]: valor } : l)));
  }

  function quitarLineaGasto(key: string) {
    setDetalleGastos((prev) => prev.filter((l) => l.key !== key));
  }

  const sumaDetalle = useMemo(
    () => Math.round((detalleGastos.reduce((s, l) => s + (parseFloat(l.monto) || 0), 0) + Number.EPSILON) * 100) / 100,
    [detalleGastos]
  );
  const montoFacturaNum = parseFloat(montoFactura) || 0;
  const detalleCuadra = Math.abs(sumaDetalle - montoFacturaNum) <= 0.01 && montoFacturaNum > 0;

  const listoParaRegistrar =
    proveedor !== null &&
    montoFacturaNum > 0 &&
    detalleCuadra &&
    conceptoPago.trim().length > 0 &&
    (formaPago !== "CHEQUE" || numeroCheque.trim().length > 0) &&
    (formaPago === "CAJA_GENERAL" || cuentaOrigenCodigo.trim().length > 0);

  async function handleRegistrarPago() {
    if (!proveedor) return;
    setRegistrando(true);
    setResultado(null);
    try {
      const r = await registrarPagoAction({
        colegioId,
        proveedorId: proveedor.id,
        fechaPago,
        formaPago,
        cuentaOrigenCodigo: formaPago === "CAJA_GENERAL" ? undefined : cuentaOrigenCodigo,
        numeroCheque: formaPago === "CHEQUE" ? numeroCheque : undefined,
        numeroFactura: numeroFactura || undefined,
        conceptoPago,
        tipoGasto,
        montoFactura: montoFacturaNum,
        baseImponibleSinIva: baseImponibleSinIva ? parseFloat(baseImponibleSinIva) : undefined,
        detalleGastos: detalleGastos
          .filter((l) => parseFloat(l.monto) > 0)
          .map((l) => ({ cuentaGastoCodigo: l.cuentaGastoCodigo, monto: parseFloat(l.monto), descripcion: l.descripcion || undefined })),
      });
      setResultado(r);
      if (r.ok) {
        setMontoFactura("");
        setBaseImponibleSinIva("");
        setNumeroFactura("");
        setConceptoPago("");
        setDetalleGastos([{ key: `${Date.now()}`, cuentaGastoCodigo: cuentasGasto[0]?.codigo ?? "", monto: "", descripcion: "" }]);
        const h = await obtenerHistorialProveedorAction(proveedor.id, fechaPago);
        setHistorial(h);
      }
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <div>
      <div className="tarjeta">
        <h2>1. Colegio y proveedor</h2>
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
          <label>Buscar proveedor (nombre, nombre comercial o RUC/cédula)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={textoProveedor}
              onChange={(e) => setTextoProveedor(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBuscarProveedor()}
              placeholder="ej. Distribuidora, J0310..."
            />
            <button className="boton-primario" onClick={handleBuscarProveedor} disabled={buscandoProveedor}>
              {buscandoProveedor ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>
        {proveedores.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>RUC/Cédula</th>
                <th>Constancia no retención</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => (
                <tr key={p.id}>
                  <td>{p.nombreComercial ?? p.nombreCompleto}</td>
                  <td>{p.rucCedula ?? "--"}</td>
                  <td>{p.tieneConstanciaNoRetencion ? "Sí (exonerado)" : "No"}</td>
                  <td>
                    <button className="boton-texto" onClick={() => seleccionarProveedor(p)}>
                      Seleccionar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {proveedor && (
          <div className="aviso aviso-exito" style={{ marginTop: 12 }}>
            Proveedor seleccionado: <strong>{proveedor.nombreComercial ?? proveedor.nombreCompleto}</strong>
            {proveedor.tieneConstanciaNoRetencion && " -- tiene constancia de no retención vigente (exonerado de retención)."}
          </div>
        )}
      </div>

      {proveedor && historial && historial.cuentasFrecuentes.length > 0 && (
        <div className="tarjeta">
          <h2>Cuentas que este proveedor usa con más frecuencia</h2>
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th>Veces usada</th>
                <th>Monto histórico</th>
                <th>Última vez</th>
              </tr>
            </thead>
            <tbody>
              {historial.cuentasFrecuentes.map((c) => (
                <tr key={c.cuentaGastoId}>
                  <td>
                    {c.codigo} -- {c.nombre}
                  </td>
                  <td>{c.vecesUsada}</td>
                  <td className="monto">C${formatoMonto(c.montoTotalHistorico)}</td>
                  <td>{new Date(c.ultimaVezUsada).toLocaleDateString("es-NI")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proveedor && (
        <div className="tarjeta">
          <h2>2. Datos del pago</h2>
          <div className="grid-2">
            <div className="campo">
              <label>Fecha de pago</label>
              <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
            </div>
            <div className="campo">
              <label>Número de factura</label>
              <input type="text" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} />
            </div>
          </div>
          <div className="grid-2">
            <div className="campo">
              <label>Tipo de gasto</label>
              <select value={tipoGasto} onChange={(e) => setTipoGasto(e.target.value as TipoGastoRetencion)}>
                <option value="COMPRA_O_SERVICIO_GENERAL">Compra o servicio general (2% si factura &gt; C$1,000)</option>
                <option value="SERVICIO_PROFESIONAL">Servicio profesional (10%)</option>
              </select>
            </div>
            <div className="campo">
              <label>Forma de pago</label>
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value as typeof formaPago)}>
                <option value="CAJA_GENERAL">Caja General</option>
                <option value="TRANSFERENCIA">Transferencia</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>
          </div>
          {formaPago !== "CAJA_GENERAL" && (
            <div className="grid-2">
              <div className="campo">
                <label>Cuenta bancaria de origen</label>
                <select value={cuentaOrigenCodigo} onChange={(e) => setCuentaOrigenCodigo(e.target.value)}>
                  {cuentasOrigen.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.codigo} -- {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              {formaPago === "CHEQUE" && (
                <div className="campo">
                  <label>Número de cheque</label>
                  <input type="text" value={numeroCheque} onChange={(e) => setNumeroCheque(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="campo">
            <label>Concepto del pago</label>
            <input type="text" value={conceptoPago} onChange={(e) => setConceptoPago(e.target.value)} placeholder="ej. Compra de papelería para oficina" />
          </div>
          <div className="grid-2">
            <div className="campo">
              <label>Monto total de la factura (con IVA)</label>
              <input type="number" min={0} step="0.01" value={montoFactura} onChange={(e) => setMontoFactura(e.target.value)} />
            </div>
            {tipoGasto === "COMPRA_O_SERVICIO_GENERAL" && (
              <div className="campo">
                <label>Base imponible sin IVA (opcional)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={baseImponibleSinIva}
                  onChange={(e) => setBaseImponibleSinIva(e.target.value)}
                  placeholder="Si se omite, se usa el monto total"
                />
              </div>
            )}
          </div>

          {vistaPrevia && (
            <div className="aviso aviso-alerta">
              Retención {vistaPrevia.porcentaje}% sobre C${formatoMonto(vistaPrevia.base)} = <strong>C${formatoMonto(vistaPrevia.monto)}</strong>.{" "}
              {vistaPrevia.motivo} Neto a pagar: <strong>C${formatoMonto(vistaPrevia.montoNetoAPagar)}</strong>.
            </div>
          )}
        </div>
      )}

      {proveedor && (
        <div className="tarjeta">
          <h2>3. Cuentas de gasto a utilizar</h2>
          {detalleGastos.map((l) => (
            <div key={l.key} style={{ display: "flex", gap: 8, alignItems: "end", marginBottom: 10 }}>
              <div className="campo" style={{ marginBottom: 0, flex: 2 }}>
                <label>Cuenta de gasto</label>
                <select value={l.cuentaGastoCodigo} onChange={(e) => actualizarLineaGasto(l.key, "cuentaGastoCodigo", e.target.value)}>
                  {cuentasGasto.map((c) => (
                    <option key={c.codigo} value={c.codigo}>
                      {c.codigo} -- {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo" style={{ marginBottom: 0, flex: 2 }}>
                <label>Descripción (opcional)</label>
                <input type="text" value={l.descripcion} onChange={(e) => actualizarLineaGasto(l.key, "descripcion", e.target.value)} />
              </div>
              <div className="campo" style={{ marginBottom: 0, flex: 1 }}>
                <label>Monto</label>
                <input type="number" min={0} step="0.01" value={l.monto} onChange={(e) => actualizarLineaGasto(l.key, "monto", e.target.value)} />
              </div>
              <button className="boton-texto" onClick={() => quitarLineaGasto(l.key)}>
                ✕
              </button>
            </div>
          ))}
          <button className="boton-secundario" onClick={agregarLineaGasto}>
            + Agregar cuenta
          </button>

          <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
            <span className={detalleCuadra ? "texto-suave" : "aviso aviso-error"} style={{ padding: detalleCuadra ? 0 : "6px 10px" }}>
              {detalleCuadra
                ? `Las cuentas de gasto suman C$${formatoMonto(sumaDetalle)}, igual a la factura.`
                : `Las cuentas de gasto suman C$${formatoMonto(sumaDetalle)}, pero la factura es de C$${formatoMonto(montoFacturaNum)}.`}
            </span>
          </div>
        </div>
      )}

      {proveedor && (
        <div className="tarjeta">
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="boton-primario" onClick={handleRegistrarPago} disabled={!listoParaRegistrar || registrando}>
              {registrando ? "Registrando..." : "Registrar pago"}
            </button>
          </div>

          {resultado && (
            <div className={`aviso ${resultado.ok ? "aviso-exito" : "aviso-error"}`} style={{ marginTop: 14 }}>
              {resultado.ok && resultado.resultado ? (
                <>
                  ✅ Pago registrado -- comprobante <strong>{resultado.resultado.claveComprobante}</strong>. Retención{" "}
                  {resultado.resultado.porcentajeRetencion}% (C${formatoMonto(resultado.resultado.montoRetencion)}). Neto pagado: C$
                  {formatoMonto(resultado.resultado.montoNetoPagado)}.
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
