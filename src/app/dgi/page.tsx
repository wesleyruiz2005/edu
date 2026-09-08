import { listarColegiosDgiAction } from "./actions";
import PantallaRetencionesDgi from "../../components/dgi/PantallaRetencionesDgi";

export const dynamic = "force-dynamic";

export default async function DgiPage() {
  const colegios = await listarColegiosDgiAction();

  return (
    <div>
      <h1>Retenciones de Impuestos por Mes (DGI)</h1>
      <p className="subtitulo">
        Junta automáticamente las retenciones del 2%/10% a proveedores (Módulo de Egresos) y del 10% a docentes por hora
        (Módulo de Nóminas) de un mes -- listo para la declaración y el pago mensual ante la DGI.
      </p>
      <PantallaRetencionesDgi colegios={colegios} />
    </div>
  );
}
