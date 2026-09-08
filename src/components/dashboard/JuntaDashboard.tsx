"use client";

/**
 * ============================================================================
 * DASHBOARD CONSOLIDADO DE LA JUNTA DIRECTIVA (punto 4, 7 sept 2026)
 * ============================================================================
 * Tablero maestro para administradores/Junta Directiva: indicadores
 * globales, gráfico de ingresos entre las 3 sedes, Top 5 de secciones con
 * mayor morosidad, filtro multi-sede, descargas a Excel de los 5 estados
 * financieros formales, y la sección especial ICCM (retenidos + comisiones
 * BAC).
 *
 * Los "gráficos dinámicos" son barras simples en CSS/SVG (sin librería de
 * gráficos externa) -- así el tablero funciona apenas Eduardo corra
 * `npm install`, sin depender de que una librería de charts sea compatible
 * con React 19. Si más adelante quiere gráficos más elaborados (líneas,
 * dona, etc.), se puede agregar `recharts` u otra librería en un paso aparte.
 */
import { useEffect, useState } from "react";
import {
  listarColegiosDashboardAction,
  obtenerIndicadoresAction,
  obtenerIngresosPorSedeAction,
  obtenerTopMorosidadAction,
  obtenerNinosRetenidosAction,
  obtenerComisionesBacAction,
  exportarBalanzaDashboardAction,
  exportarEstadoResultadosDashboardAction,
  exportarBalanceGeneralDashboardAction,
  exportarLibroDiarioDashboardAction,
  exportarLibroMayorDashboardAction,
  exportarTopMorosidadAction,
  exportarNinosRetenidosAction,
  exportarComisionesBacAction,
  type ColegioOpcion,
  type IndicadoresGlobales,
  type IngresoPorSede,
} from "../../app/dashboard/actions";
import type { SeccionMorosidad } from "../../lib/reportes/morosidad";
import type { NinoRetenidoAuditoria, ComisionBacMes } from "../../lib/reportes/iccm-auditoria";
import BotonDescargarExcel from "../shared/BotonDescargarExcel";

interface Props {
  colegios: ColegioOpcion[];
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
const MESES_CORTOS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function JuntaDashboard({ colegios }: Props) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [colegioId, setColegioId] = useState<number | "">("");

  const [indicadores, setIndicadores] = useState<IndicadoresGlobales | null>(null);
  const [ingresosPorSede, setIngresosPorSede] = useState<IngresoPorSede[]>([]);
  const [topMorosidad, setTopMorosidad] = useState<SeccionMorosidad[]>([]);
  const [ninosRetenidos, setNinosRetenidos] = useState<NinoRetenidoAuditoria[]>([]);
  const [comisionesBac, setComisionesBac] = useState<ComisionBacMes[]>([]);
  const [cargando, setCargando] = useState(false);

  const [colegioLibro, setColegioLibro] = useState<number | "">("");
  const [cuentaMayor, setCuentaMayor] = useState("");

  useEffect(() => {
    if (colegios.length > 0 && colegioLibro === "") setColegioLibro(colegios[0].id);
  }, [colegios, colegioLibro]);

  async function cargarTodo() {
    setCargando(true);
    try {
      const cid = colegioId === "" ? undefined : colegioId;
      const [ind, ingresos, morosidad, retenidos, comisiones] = await Promise.all([
        obtenerIndicadoresAction(anio, mes, cid),
        obtenerIngresosPorSedeAction(anio, mes),
        obtenerTopMorosidadAction(cid),
        obtenerNinosRetenidosAction(anio, mes),
        obtenerComisionesBacAction(anio),
      ]);
      setIndicadores(ind);
      setIngresosPorSede(ingresos);
      setTopMorosidad(morosidad);
      setNinosRetenidos(retenidos);
      setComisionesBac(comisiones);
    } finally {
      setCargando(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    cargarTodo();
  }, [anio, mes, colegioId]);

  const maxIngresoSede = Math.max(1, ...ingresosPorSede.map((s) => s.totalIngresos));
  const maxMorosidad = Math.max(1, ...topMorosidad.map((s) => s.totalVencido));

  return (
    <div>
      <div className="tarjeta">
        <h2>Filtros</h2>
        <div className="grid-2">
          <div className="campo">
            <label>Año</label>
            <input type="number" value={anio} onChange={(e) => setAnio(Number(e.target.value))} />
          </div>
          <div className="campo">
            <label>Mes (acumulado hasta este mes)</label>
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
          <label>Sede (filtro multi-sede)</label>
          <select value={colegioId} onChange={(e) => setColegioId(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">-- Balanza Total consolidada (3 sedes) --</option>
            {colegios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {cargando && <p className="texto-suave">Cargando indicadores...</p>}

      {indicadores && !cargando && (
        <>
          <div className="tarjeta">
            <h2>Indicadores Globales -- {indicadores.colegioNombre}</h2>
            <div className="tarjetas-resumen">
              <div className="resumen-item acento-primario">
                <div className="texto-suave">Ingresos del periodo</div>
                <div className="valor">C${formatoMonto(indicadores.totalIngresosMes)}</div>
              </div>
              <div className="resumen-item">
                <div className="texto-suave">Gastos del periodo</div>
                <div className="valor">C${formatoMonto(indicadores.totalGastosMes)}</div>
              </div>
              <div className="resumen-item">
                <div className="texto-suave">Utilidad del periodo</div>
                <div className="valor">C${formatoMonto(indicadores.utilidadMes)}</div>
              </div>
              <div className="resumen-item">
                <div className="texto-suave">Saldo pendiente total (alumnos)</div>
                <div className="valor">C${formatoMonto(indicadores.saldoTotalPendiente)}</div>
              </div>
              <div className="resumen-item acento-peligro">
                <div className="texto-suave">Saldo vencido total</div>
                <div className="valor">C${formatoMonto(indicadores.saldoVencidoTotal)}</div>
              </div>
              <div className="resumen-item">
                <div className="texto-suave">Cuadre contable</div>
                <div className="valor" style={{ fontSize: 16 }}>
                  {indicadores.cuadrado ? (
                    <span className="badge badge-al-dia">OK - Cuadrado</span>
                  ) : (
                    <span className="badge badge-vencido">DESCUADRADO</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="tarjeta">
            <h2>Ingresos entre las 3 sedes -- {MESES[mes]} {anio} (acumulado)</h2>
            {ingresosPorSede.length === 0 ? (
              <p className="texto-suave">Sin datos todavía.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ingresosPorSede.map((s) => (
                  <div key={s.colegioId}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span>{s.colegioNombre}</span>
                      <span className="monto">C${formatoMonto(s.totalIngresos)}</span>
                    </div>
                    <div style={{ background: "var(--color-fondo)", borderRadius: 4, height: 14, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${Math.max(2, (s.totalIngresos / maxIngresoSede) * 100)}%`,
                          background: "var(--color-primario)",
                          height: "100%",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="tarjeta">
            <h2>Top 5 secciones con mayor morosidad{colegioId ? "" : " (3 sedes)"}</h2>
            {topMorosidad.length === 0 ? (
              <p className="texto-suave">Ninguna sección tiene cargos vencidos en este momento.</p>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
                  {topMorosidad.map((s, i) => (
                    <div key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                        <span>
                          {s.colegioNombre} -- {s.nivelAcademico} {s.seccionNombre} ({s.cantidadAlumnosVencidos} alumno(s))
                        </span>
                        <span className="monto">C${formatoMonto(s.totalVencido)}</span>
                      </div>
                      <div style={{ background: "var(--color-fondo)", borderRadius: 4, height: 14, overflow: "hidden" }}>
                        <div
                          style={{
                            width: `${Math.max(2, (s.totalVencido / maxMorosidad) * 100)}%`,
                            background: "var(--color-peligro)",
                            height: "100%",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <BotonDescargarExcel etiqueta="Descargar Top Morosidad (Excel)" accion={() => exportarTopMorosidadAction(colegioId === "" ? undefined : colegioId)} />
              </>
            )}
          </div>

          <div className="tarjeta">
            <h2>Informes Financieros en Excel -- {indicadores.colegioNombre}, {MESES[mes]} {anio}</h2>
            <p className="texto-suave" style={{ marginTop: 0 }}>
              Balance General, Estado de Resultados y Balanza de Comprobación siguen el filtro de Sede/Año/Mes de arriba.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
              <BotonDescargarExcel
                etiqueta="Balance General"
                accion={() => exportarBalanceGeneralDashboardAction(anio, mes, colegioId === "" ? undefined : colegioId)}
              />
              <BotonDescargarExcel
                etiqueta="Estado de Resultados"
                accion={() => exportarEstadoResultadosDashboardAction(anio, mes, colegioId === "" ? undefined : colegioId)}
              />
              <BotonDescargarExcel
                etiqueta="Balanza de Comprobación"
                accion={() => exportarBalanzaDashboardAction(anio, mes, colegioId === "" ? undefined : colegioId)}
              />
            </div>

            <p className="texto-suave" style={{ marginBottom: 8 }}>
              El Libro Diario y el Libro Mayor son SIEMPRE de UNA sede específica (cada colegio lleva el suyo por
              separado) -- elige la sede aquí abajo, sin importar el filtro de arriba.
            </p>
            <div className="grid-2">
              <div className="campo">
                <label>Sede para Libro Diario / Libro Mayor</label>
                <select value={colegioLibro} onChange={(e) => setColegioLibro(Number(e.target.value))}>
                  {colegios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label>Código de cuenta (solo para Libro Mayor, ej. 110101)</label>
                <input type="text" value={cuentaMayor} onChange={(e) => setCuentaMayor(e.target.value)} placeholder="110101" />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <BotonDescargarExcel
                etiqueta="Libro Diario"
                accion={() => exportarLibroDiarioDashboardAction(colegioLibro === "" ? colegios[0]?.id : colegioLibro, anio, mes)}
                disabled={colegioLibro === ""}
              />
              <BotonDescargarExcel
                etiqueta="Libro Mayor"
                accion={() =>
                  exportarLibroMayorDashboardAction(colegioLibro === "" ? colegios[0]?.id : colegioLibro, cuentaMayor.trim(), anio)
                }
                disabled={colegioLibro === "" || cuentaMayor.trim() === ""}
              />
            </div>
          </div>

          <div className="tarjeta">
            <h2>Sección Especial ICCM -- Auditoría</h2>
            <h3 style={{ fontSize: 13.5, marginBottom: 8 }}>
              Niños en estado &quot;Retenido&quot; ({MESES[mes]} {anio}) -- falta foto/carta
            </h3>
            {ninosRetenidos.length === 0 ? (
              <p className="texto-suave">Ningún niño retenido este mes.</p>
            ) : (
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Código NC</th>
                    <th>Nombre</th>
                    <th>Motivo</th>
                    <th>Monto Base (US$)</th>
                  </tr>
                </thead>
                <tbody>
                  {ninosRetenidos.map((n) => (
                    <tr key={n.codigoNc}>
                      <td>{n.codigoNc}</td>
                      <td>{n.nombreCompleto}</td>
                      <td>{n.motivoRetencion ?? "--"}</td>
                      <td className="monto">US${formatoMonto(n.montoBase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <BotonDescargarExcel etiqueta="Descargar Retenidos ICCM (Excel)" accion={() => exportarNinosRetenidosAction(anio, mes)} />

            <h3 style={{ fontSize: 13.5, margin: "20px 0 8px" }}>Comisiones Banco Nacional BAC -- {anio}</h3>
            {comisionesBac.length === 0 ? (
              <p className="texto-suave">Sin comisiones BAC registradas este año.</p>
            ) : (
              <table style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Comisión BAC (US$)</th>
                    <th>Registrada</th>
                  </tr>
                </thead>
                <tbody>
                  {comisionesBac.map((c) => (
                    <tr key={c.mes}>
                      <td>{MESES_CORTOS[c.mes]}</td>
                      <td className="monto">US${formatoMonto(c.comisionBacNacional)}</td>
                      <td>{c.comisionBacRegistrada ? <span className="badge badge-al-dia">Sí</span> : <span className="badge badge-vencido">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <BotonDescargarExcel etiqueta="Descargar Comisiones BAC (Excel)" accion={() => exportarComisionesBacAction(anio)} />
          </div>
        </>
      )}
    </div>
  );
}
