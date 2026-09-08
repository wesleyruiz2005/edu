import { prisma } from "../../lib/prisma";
import { listarCuentasDeIngresoAction } from "./actions";
import PantallaCajera from "../../components/caja/PantallaCajera";

export const dynamic = "force-dynamic"; // siempre lee colegios/cuentas frescos, esto no es una página estática

export default async function CajaPage() {
  const [colegios, cuentasIngreso] = await Promise.all([
    prisma.colegio.findMany({ orderBy: { nombre: "asc" }, select: { id: true, codigo: true, nombre: true } }),
    listarCuentasDeIngresoAction(),
  ]);

  return (
    <div>
      <h1>Pantalla de Cajera</h1>
      <p className="subtitulo">Punto de venta: busca al alumno, revisa su saldo y emite el Recibo Oficial de Caja (ROC).</p>
      <PantallaCajera colegios={colegios} cuentasIngreso={cuentasIngreso} />
    </div>
  );
}
