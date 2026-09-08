/**
 * ============================================================================
 * MÓDULO DE COBRANZA Y MENSAJERÍA DINÁMICA POR WHATSAPP (punto 3, 7 sept 2026)
 * ============================================================================
 * Arma el texto de cobranza a partir del estado de cuenta REAL del alumno
 * (`estado-cuenta.ts` -- el mismo que ve la cajera), extrayendo tutor,
 * alumno, colegio, grado, detalle de meses vencidos (con el 10% de mora ya
 * aplicado si pasó del día 5, tal como lo calcula `procesarPago`/
 * `aplicar-mora.ts`), aranceles pendientes que aún no vencen, y el saldo
 * total. Deja constancia en `mensajes_cobranza_whatsapp` (tabla que ya
 * existía en el schema) para tener auditoría de qué se generó y cuándo.
 *
 * El link `wa.me` NO envía nada por sí solo -- abre WhatsApp Web/App con el
 * mensaje ya escrito, listo para que la cajera/administración le dé "Enviar"
 * (Eduardo pidió "enlaces de WhatsApp para envío inmediato", no integración
 * con la API oficial de WhatsApp Business, que requiere cuenta/costo aparte
 * -- si más adelante quiere automatizar el envío 100%, avisar para cotizar
 * esa integración).
 */
import type { PrismaClient } from "@prisma/client";
import { buscarEstudianteConEstadoDeCuenta, type EstadoCuentaEstudiante } from "./estado-cuenta";

export interface MensajeCobranzaGenerado {
  telefonoTutor: string | null;
  mensajeTexto: string;
  /** null si el alumno no tiene teléfono de tutor registrado -- la pantalla debe avisar para que se complete el dato o se copie el mensaje a mano. */
  linkWhatsapp: string | null;
}

function formatoMonto(n: number): string {
  return n.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES_CORTOS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Nicaragua: números locales tienen 8 dígitos: wa.me exige el código de país (505) delante. Si ya viene con código o con otro formato, se deja tal cual (solo se limpia todo lo que no sea dígito). */
function normalizarTelefonoNicaragua(telefono: string | null): string | null {
  if (!telefono) return null;
  const soloDigitos = telefono.replace(/\D/g, "");
  if (soloDigitos.length === 0) return null;
  if (soloDigitos.length === 8) return `505${soloDigitos}`;
  return soloDigitos;
}

/** Arma el texto + el link `wa.me` a partir de un estado de cuenta YA calculado (no toca la base de datos -- función pura, fácil de probar). */
export function generarMensajeCobranza(
  estudiante: EstadoCuentaEstudiante,
  colegioNombre: string,
  telefonoTutor: string | null
): MensajeCobranzaGenerado {
  const vencidos = estudiante.cargosPendientes.filter((c) => c.vencido);
  const pendientesNoVencidos = estudiante.cargosPendientes.filter((c) => !c.vencido);

  const detalleMeses =
    vencidos.length > 0
      ? vencidos
          .map((c) => {
            const etiquetaMes = c.mes ? `${MESES_CORTOS[c.mes]}/${c.anioLectivo}` : `${c.anioLectivo}`;
            const conMora = c.recargoMoraMonto > 0 ? " (incluye 10% de recargo por mora)" : "";
            return `  • ${c.concepto} ${etiquetaMes}: C$${formatoMonto(c.saldoPendiente)}${conMora}`;
          })
          .join("\n")
      : "";

  const detalleOtros =
    pendientesNoVencidos.length > 0
      ? `\n\nOtros aranceles pendientes (aún no vencidos):\n${pendientesNoVencidos
          .map((c) => `  • ${c.concepto}: C$${formatoMonto(c.saldoPendiente)}`)
          .join("\n")}`
      : "";

  const mensajeTexto =
    `Estimado(a) ${estudiante.nombreTutor}:\n\n` +
    `Le saludamos de ${colegioNombre} con relación al estado de cuenta de ${estudiante.nombreCompleto}` +
    ` (${estudiante.nivelAcademico}${estudiante.seccion ? `, Sección ${estudiante.seccion}` : ""}).\n\n` +
    (vencidos.length > 0
      ? `Actualmente tiene ${vencidos.length} mes(es)/cargo(s) VENCIDO(S):\n${detalleMeses}\n\n`
      : "Su cuenta no registra cargos vencidos por el momento.\n\n") +
    `Saldo total adeudado: C$${formatoMonto(estudiante.saldoTotalPendiente)}` +
    (estudiante.saldoVencido > 0 ? ` (de los cuales C$${formatoMonto(estudiante.saldoVencido)} ya están vencidos).` : ".") +
    detalleOtros +
    `\n\nLe agradecemos ponerse al día a la brevedad posible. Cualquier consulta, con gusto le atendemos.\n\n` +
    `Administración -- ${colegioNombre}`;

  const telefonoNormalizado = normalizarTelefonoNicaragua(telefonoTutor);
  const linkWhatsapp = telefonoNormalizado ? `https://wa.me/${telefonoNormalizado}?text=${encodeURIComponent(mensajeTexto)}` : null;

  return { telefonoTutor, mensajeTexto, linkWhatsapp };
}

/** Genera el mensaje de UN alumno (consultando su estado de cuenta real) y deja constancia en `mensajes_cobranza_whatsapp`. Es lo que llama el botón de WhatsApp de la Pantalla de Cajera. */
export async function generarYRegistrarMensajeCobranza(
  prisma: PrismaClient,
  estudianteId: number
): Promise<MensajeCobranzaGenerado & { estudiante: EstadoCuentaEstudiante }> {
  const est = await prisma.estudiante.findUniqueOrThrow({ where: { id: estudianteId }, include: { colegio: true } });
  const estadoCuenta = await buscarEstudianteConEstadoDeCuenta(prisma, est.colegioId, est.codigoEstudiantil);
  if (!estadoCuenta) {
    throw new Error(`No se pudo reconstruir el estado de cuenta del alumno #${estudianteId} (${est.nombreCompleto}).`);
  }

  const generado = generarMensajeCobranza(estadoCuenta, est.colegio.nombre, est.telefonoTutor);

  const detalleMesesPendientes = estadoCuenta.cargosPendientes
    .filter((c) => c.vencido)
    .map((c) => `${c.concepto} ${c.mes ? `${c.mes}/${c.anioLectivo}` : c.anioLectivo}`)
    .join(", ");

  await prisma.mensajeCobranzaWhatsapp.create({
    data: {
      estudianteId,
      saldoAlMomento: estadoCuenta.saldoTotalPendiente,
      detalleMesesPendientes: detalleMesesPendientes || null,
      mensajeTexto: generado.mensajeTexto,
    },
  });

  return { ...generado, estudiante: estadoCuenta };
}
