"use client";

import { exportarPlanillaAction, nombreTipoNomina, type PlanillaResumen } from "../../app/nomina/actions";
import BotonDescargarExcel from "../shared/BotonDescargarExcel";

interface Props {
  planillas: PlanillaResumen[];
}

const MESES_CORTOS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PantallaNomina({ planillas }: Props) {
  if (planillas.length === 0) {
    return (
      <div className="tarjeta">
        <p className="texto-suave">
          Todavía no hay ninguna planilla registrada. Se crean con <code>registrarPlanillaMensual()</code> /{" "}
          <code>jornalizarPlanilla()</code> (ver <code>src/lib/nomina/registrar-planilla.ts</code>) -- desde ahí, en cuanto
          exista al menos una planilla del mes, aparece aquí lista para descargar en Excel.
        </p>
      </div>
    );
  }

  return (
    <div className="tarjeta">
      <table>
        <thead>
          <tr>
            <th>Colegio</th>
            <th>Tipo de Nómina</th>
            <th>Periodo</th>
            <th>Estado</th>
            <th>Empleados</th>
            <th>Total Neto</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {planillas.map((p) => (
            <tr key={p.id}>
              <td>{p.colegioNombre}</td>
              <td>{nombreTipoNomina(p.tipoNomina)}</td>
              <td>
                {MESES_CORTOS[p.mes]}/{p.anio}
              </td>
              <td>
                {p.estado === "CERRADO" ? (
                  <span className="badge badge-al-dia">Jornalizada</span>
                ) : (
                  <span className="badge badge-vencido">Abierta</span>
                )}
              </td>
              <td>{p.totalEmpleados}</td>
              <td className="monto">C${formatoMonto(p.totalNeto)}</td>
              <td>
                <BotonDescargarExcel etiqueta="Excel" accion={() => exportarPlanillaAction(p.id)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
