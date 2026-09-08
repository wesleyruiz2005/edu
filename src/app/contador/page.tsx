import { listarColegiosContadorAction } from "./actions";
import PantallaContador from "../../components/contador/PantallaContador";

export const dynamic = "force-dynamic";

export default async function ContadorPage() {
  const colegios = await listarColegiosContadorAction();

  return (
    <div>
      <h1>Libro Diario, Libro Mayor y Cierres</h1>
      <p className="subtitulo">
        Jornalización cronológica, mayor por cuenta contable, y cierre mensual/anual con validación de cuadre --
        exportables a Excel.
      </p>
      <PantallaContador colegios={colegios} />
    </div>
  );
}
