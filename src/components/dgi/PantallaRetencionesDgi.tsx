"use client";

import { useEffect, useState } from "react";
import { obtenerRetencionesDgiAction, exportarRetencionesDgiAction } from "../../app/dgi/actions";
import type { ReporteRetencionesDgi } from "../../lib/reportes/retenciones-dgi";
import BotonDescargarExcel from "../shared/BotonDescargarExcel";

interface Colegio {
  id: number;
  codigo: string;
  nombre: string;
}

interface Props {
  colegios: Colegio[];
}

const MESES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PantallaRetencionesDgi({ colegios }: Props) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [colegioId, setColegioId] = useState<number | "">("");
  const [reporte, setReporte] = useState<ReporteRetencionesDgi | null>(null);
  const [cargando, setCargando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const r = await obtenerRetencionesDgiAction(anio, mes, colegioId === "" ? undefined : colegioId);
      setReporte(r);
    } finally {
      setCargando(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    cargar();
  }, [anio, mes, colegioId]);

  return (
    <div>
      <div className="tarjeta">
        <div className="grid-2">
          <div className="campo">
            <label>Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
          </div>
          <div className="campo">
            <label>Mes</label>
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="campo">
          <label>Colegio (opcional -- vacío = los 3 juntos)</label>
          <select value={colegioId} onChange={(e) => setColegioId(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">-- Los 3 colegios --</option>
            {colegios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        {reporte && (
          <BotonDescargarExcel
            etiqueta="Descargar Excel (listo para la declaración DGI)"
            className="boton-primario"
            accion={() => exportarRetencionesDgiAction(anio, mes, colegioId === "" ? undefined : colegioId)}
          />
        )}
      </div>

      {cargando && <p className="texto-suave">Cargando...</p>}

      {reporte && !cargando && (
        <>
          <div className="tarjetas-resumen">
            <div className="resumen-item">
              <div className="texto-suave">Retención 2% proveedores</div>
              <div className="valor">C${formatoMonto(reporte.totalRetencion2PorcientoProveedores)}</div>
            </div>
            <div className="resumen-item">
              <div className="texto-suave">Retención 10% proveedores</div>
              <div className="valor">C${formatoMonto(reporte.totalRetencion10PorcientoProveedores)}</div>
            </div>
            <div className="resumen-item">
              <div className="texto-suave">Retención 10% docentes por hora</div>
              <div className="valor">C${formatoMonto(reporte.totalRetencion10PorcientoDocentes)}</div>
            </div>
          </div>
          <div className="tarjeta">
            <h2>
              Total a declarar/pagar a la DGI:{" "}
              <span className="monto" style={{ fontSize: 18 }}>
                C${formatoMonto(reporte.totalGeneral)}
              </span>
            </h2>
            {reporte.renglones.length === 0 ? (
              <p className="texto-suave">No hay retenciones registradas en este periodo.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Colegio</th>
                    <th>Nombre</th>
                    <th>RUC/Cédula</th>
                    <th># Factura/Planilla</th>
                    <th>Monto Base</th>
                    <th>%</th>
                    <th>Retención</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.renglones.map((r, i) => (
                    <tr key={i}>
                      <td>{r.fecha.slice(0, 10)}</td>
                      <td>{r.tipo === "PROVEEDOR" ? "Proveedor" : "Docente por Hora"}</td>
                      <td>{r.colegioNombre}</td>
                      <td>{r.nombre}</td>
                      <td>{r.rucCedula || "--"}</td>
                      <td>{r.numeroDocumento}</td>
                      <td className="monto">C${formatoMonto(r.montoBase)}</td>
                      <td>{r.porcentajeRetencion}%</td>
                      <td className="monto">C${formatoMonto(r.montoRetencion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
