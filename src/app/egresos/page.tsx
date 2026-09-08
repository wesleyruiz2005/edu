import { prisma } from "../../lib/prisma";
import { listarCuentasDeGastoAction, listarCuentasDeOrigenAction } from "./actions";
import PantallaEgresos from "../../components/egresos/PantallaEgresos";

export const dynamic = "force-dynamic";

export default async function EgresosPage() {
  const [colegios, cuentasGasto, cuentasOrigen] = await Promise.all([
    prisma.colegio.findMany({ orderBy: { nombre: "asc" }, select: { id: true, codigo: true, nombre: true } }),
    listarCuentasDeGastoAction(),
    listarCuentasDeOrigenAction(),
  ]);

  return (
    <div>
      <h1>Egresos y Proveedores</h1>
      <p className="subtitulo">
        Registra un pago a proveedor: la retención (2% compra/servicio general, 10% servicio profesional) y la
        jornalización se calculan solas.
      </p>
      <PantallaEgresos colegios={colegios} cuentasGasto={cuentasGasto} cuentasOrigen={cuentasOrigen} />
    </div>
  );
}
