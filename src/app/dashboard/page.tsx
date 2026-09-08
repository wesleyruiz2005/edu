import { listarColegiosDashboardAction } from "./actions";
import JuntaDashboard from "../../components/dashboard/JuntaDashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const colegios = await listarColegiosDashboardAction();

  return (
    <div>
      <h1>Dashboard Consolidado -- Junta Directiva</h1>
      <p className="subtitulo">
        Tablero maestro multi-sede: indicadores globales, ingresos entre las 3 sedes, morosidad por sección, informes
        financieros formales en Excel, y la auditoría especial del Programa ICCM.
      </p>
      <JuntaDashboard colegios={colegios} />
    </div>
  );
}
