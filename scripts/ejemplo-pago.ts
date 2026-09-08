/**
 * EJEMPLO de cómo la Pantalla de Cajera llamaría a procesarPago().
 * No lo corras contra una base de datos vacía (los IDs son de ejemplo) --
 * es para que veas la FORMA del objeto de pago y qué devuelve la función.
 *
 * Escenario: una mamá llega el 20 de enero a pagar la mensualidad de enero
 * de su hijo (ya vencida -- se le calcula la mora del 10% al momento de
 * cobrar) y de una vez compra una camisa del uniforme escolar. Todo en un
 * solo recibo (un solo ROC), con un solo asiento contable de 3 líneas
 * (1 débito a Caja General + 2 créditos: Mensualidad y Ventas de Uniformes).
 */
import { prisma } from "../src/lib/prisma";
import { procesarPago, type ObjetoPago } from "../src/lib/caja/procesar-pago";

async function main() {
  const objetoPago: ObjetoPago = {
    colegioId: 1, // CMLM
    fecha: new Date("2026-01-20"),
    formaPago: "EFECTIVO",
    estudianteId: 42,
    creadoPor: "Caja 1 - Eduardo",
    observacion: "Mensualidad enero (con mora) + uniforme escolar",
    lineas: [
      {
        tipo: "ARANCEL_ACTUAL",
        cargoEstudianteId: 12345n, // el cargo de Mensualidad-Enero de este alumno
        monto: 650, // procesarPago calcula la mora aparte y la suma al saldo, no hace falta incluirla aquí
      },
      {
        tipo: "OTRO_INGRESO",
        descripcion: "Camisa uniforme escolar talla 8",
        cuentaContableCodigo: "410XXX", // la cuenta real de "Venta de Uniformes" de tu catálogo
        monto: 250,
        estudianteId: 42,
      },
    ],
  };

  const resultado = await procesarPago(prisma, objetoPago);

  console.log("ROC generado:", resultado.numeroRoc);
  console.log("Total cobrado:", resultado.montoTotalCobrado);
  console.log("Comprobantes:", resultado.comprobantesGenerados);
  console.log("Alertas para la cajera:", resultado.alertas);
}

main()
  .catch((e) => console.error("❌", e.message))
  .finally(() => prisma.$disconnect());
