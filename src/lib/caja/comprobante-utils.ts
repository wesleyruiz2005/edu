import type { Prisma, LibroContable, TipoComprobante } from "@prisma/client";

/** Alias corto para "el cliente de Prisma dentro de una transacción". */
export type Tx = Prisma.TransactionClient;

/**
 * Calcula el próximo número de comprobante para un colegio+libro+tipo
 * (ej. el próximo "REC" del libro COLEGIO del colegio CMLM). Debe llamarse
 * SIEMPRE dentro de la misma transacción que crea el comprobante, para que
 * dos cajeras cobrando al mismo tiempo no puedan sacar el mismo número.
 */
export async function siguienteNumeroComprobante(
  tx: Tx,
  params: { colegioId: number; libro: LibroContable; tipoComprobante: TipoComprobante }
): Promise<number> {
  const ultimo = await tx.comprobante.findFirst({
    where: { colegioId: params.colegioId, libro: params.libro, tipoComprobante: params.tipoComprobante },
    orderBy: { numeroComprobante: "desc" },
    select: { numeroComprobante: true },
  });
  return (ultimo?.numeroComprobante ?? 0) + 1;
}

/** Próximo número de ROC (Recibo Oficial de Caja) de un colegio, como texto de 6 dígitos ("000123"). */
export async function siguienteNumeroRoc(tx: Tx, colegioId: number): Promise<string> {
  const ultimo = await tx.reciboCaja.findFirst({
    where: { colegioId },
    orderBy: { id: "desc" },
    select: { numeroRoc: true },
  });
  const ultimoNumero = ultimo ? parseInt(ultimo.numeroRoc.replace(/\D/g, ""), 10) || 0 : 0;
  return String(ultimoNumero + 1).padStart(6, "0");
}

/**
 * Busca una CatalogoCuenta por su código DENTRO de un libro específico (el
 * código ya no es único a secas). Red de seguridad: rechaza cuentas tipo
 * `MAYOR` (agrupadoras, ej. "2106 Retenciones Por Pagar") -- un asiento solo
 * puede imputarse a cuentas `DETALLE`, tal como quedó documentado desde
 * `diseno-base-datos.md` ("un asiento solo puede imputarse a cuentas con
 * tipo_cuenta = 'D'"), pero antes no se validaba en código.
 */
export async function obtenerCuenta(tx: Tx, libro: LibroContable, codigo: string) {
  const cuenta = await tx.catalogoCuenta.findUnique({ where: { libro_codigo: { libro, codigo } } });
  if (!cuenta) {
    throw new Error(`No existe la cuenta contable "${codigo}" en el libro ${libro}. Revisa el catálogo de cuentas.`);
  }
  if (cuenta.tipoCuenta === "MAYOR") {
    throw new Error(
      `La cuenta "${codigo} ${cuenta.nombre}" (libro ${libro}) es de tipo MAYOR (agrupadora) -- no se le pueden imputar asientos directamente. Usa uno de sus códigos DETALLE hijos.`
    );
  }
  return cuenta;
}

/**
 * Letra de mes A(enero)...L(diciembre) -- el mismo esquema que ya usaba el
 * libro diario histórico de ICCM (ej. "H-01" = agosto). Se reutiliza acá
 * para la numeración del Módulo de Pago (punto 5: "26-A-01", "26-B-01"...).
 */
const LETRAS_MES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export function letraDeMes(mes: number): string {
  if (mes < 1 || mes > 12) throw new Error(`Mes inválido: ${mes} (debe ser 1-12).`);
  return LETRAS_MES[mes - 1];
}

/**
 * Próximo número de comprobante "YY-X-NN" para un colegio+libro+mes, con un
 * contador INDEPENDIENTE del `numeroComprobante` interno (ese sigue siendo
 * un correlativo simple por tipo, para no romper nada de lo ya construido).
 * NN reinicia cada mes (empieza en 01 el día 1 de cada mes). Debe llamarse
 * SIEMPRE dentro de la misma transacción que crea el comprobante, para que
 * dos pagos al mismo tiempo no saquen el mismo número.
 */
export async function siguienteNumeroAsientoMensual(
  tx: Tx,
  params: { colegioId: number; libro: LibroContable; anio: number; mes: number }
): Promise<string> {
  const contador = await tx.comprobanteContadorMensual.upsert({
    where: {
      colegioId_libro_anio_mes: {
        colegioId: params.colegioId,
        libro: params.libro,
        anio: params.anio,
        mes: params.mes,
      },
    },
    create: { colegioId: params.colegioId, libro: params.libro, anio: params.anio, mes: params.mes, ultimoNumero: 1 },
    update: { ultimoNumero: { increment: 1 } },
  });
  const yy = String(params.anio).slice(-2);
  const nn = String(contador.ultimoNumero).padStart(2, "0");
  return `${yy}-${letraDeMes(params.mes)}-${nn}`;
}
