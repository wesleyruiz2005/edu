import { listarPlanillasAction } from "./actions";
import PantallaNomina from "../../components/nomina/PantallaNomina";

export const dynamic = "force-dynamic";

export default async function NominaPage() {
  const planillas = await listarPlanillasAction();

  return (
    <div>
      <h1>Nóminas</h1>
      <p className="subtitulo">
        Planillas mensuales de los 3 colegios (Personal Fijo, Docente por Hora, Contrato de Servicios Generales, y las 2
        de El Buen Pastor -- Inscrito/No Inscrito al INSS). Cada una se puede descargar en Excel, desglosada por
        empleado, con salario bruto, deducciones (INSS/IR) y neto a recibir.
      </p>
      <PantallaNomina planillas={planillas} />
    </div>
  );
}
