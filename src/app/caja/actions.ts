"use server";

/**
 * Server Actions de la Pantalla de Cajera. Son el único puente entre el
 * componente de cliente (`PantallaCajera.tsx`) y el motor contable real en
 * `src/lib` -- así el navegador nunca toca Prisma directamente y toda
 * validación/asiento contable sigue pasando por `procesarPago()`.
 */
import { prisma } from "../../lib/prisma";
import { buscarEstudianteConEstadoDeCuenta, type EstadoCuentaEstudiante } from "../../lib/reportes/estado-cuenta";
import { procesarPago, type LineaPago, type ObjetoPago } from "../../lib/caja/procesar-pago";
import { generarYRegistrarMensajeCobranza } from "../../lib/reportes/whatsapp-sender";

export interface BuscarEstudianteResultado {
  ok: boolean;
  mensaje?: string;
  estudiante?: EstadoCuentaEstudiante;
}

export async function buscarEstudianteAction(colegioId: number, codigo: string): Promise<BuscarEstudianteResultado> {
  if (!codigo || codigo.trim().length === 0) {
    return { ok: false, mensaje: "Escribe el Código NC (o el código interno) del alumno." };
  }
  try {
    const estudiante = await buscarEstudianteConEstadoDeCuenta(prisma, colegioId, codigo);
    if (!estudiante) {
      return { ok: false, mensaje: `No se encontró ningún alumno con código "${codigo}" en este colegio.` };
    }
    return { ok: true, estudiante };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado buscando al alumno." };
  }
}

/** Cada línea que la cajera arma en pantalla, ya en forma "plana" (sin BigInt, para poder viajar por la Server Action). */
export type LineaCajeraEntrada =
  | { tipo: "ARANCEL_ACTUAL"; cargoEstudianteId: string; monto: number }
  | { tipo: "OTRO_INGRESO"; descripcion: string; cuentaContableCodigo: string; monto: number; estudianteId?: number }
  | { tipo: "ANTICIPO"; estudianteId: number; anioLectivoDestinoAnio: number; conceptoClave: "matricula" | "papeleria" | "decimoTercero"; monto: number };

export interface EmitirRocEntrada {
  colegioId: number;
  estudianteId?: number;
  formaPago: "EFECTIVO" | "TRANSFERENCIA" | "TARJETA";
  observacion?: string;
  creadoPor?: string;
  lineas: LineaCajeraEntrada[];
}

export interface EmitirRocResultado {
  ok: boolean;
  mensaje?: string;
  numeroRoc?: string;
  montoTotalCobrado?: number;
  comprobantes?: { claveComprobante: string; libro: string }[];
  alertas?: string[];
}

export async function emitirRocAction(entrada: EmitirRocEntrada): Promise<EmitirRocResultado> {
  if (entrada.lineas.length === 0) {
    return { ok: false, mensaje: "Agrega al menos un arancel, uniforme, certificado o anticipo antes de emitir el ROC." };
  }

  const lineas: LineaPago[] = entrada.lineas.map((l) => {
    if (l.tipo === "ARANCEL_ACTUAL") {
      return { tipo: "ARANCEL_ACTUAL", cargoEstudianteId: BigInt(l.cargoEstudianteId), monto: l.monto };
    }
    if (l.tipo === "ANTICIPO") {
      return {
        tipo: "ANTICIPO",
        estudianteId: l.estudianteId,
        anioLectivoDestinoAnio: l.anioLectivoDestinoAnio,
        conceptoClave: l.conceptoClave,
        monto: l.monto,
      };
    }
    return {
      tipo: "OTRO_INGRESO",
      descripcion: l.descripcion,
      cuentaContableCodigo: l.cuentaContableCodigo,
      monto: l.monto,
      estudianteId: l.estudianteId,
    };
  });

  const pago: ObjetoPago = {
    colegioId: entrada.colegioId,
    fecha: new Date(),
    formaPago: entrada.formaPago,
    estudianteId: entrada.estudianteId,
    observacion: entrada.observacion,
    creadoPor: entrada.creadoPor,
    lineas,
  };

  try {
    const resultado = await procesarPago(prisma, pago);
    return {
      ok: true,
      numeroRoc: resultado.numeroRoc,
      montoTotalCobrado: resultado.montoTotalCobrado,
      comprobantes: resultado.comprobantesGenerados.map((c) => ({ claveComprobante: c.claveComprobante, libro: c.libro })),
      alertas: resultado.alertas,
    };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado emitiendo el ROC." };
  }
}

export interface MensajeWhatsappResultado {
  ok: boolean;
  mensaje?: string;
  linkWhatsapp?: string | null;
  mensajeTexto?: string;
  telefonoTutor?: string | null;
}

/** Punto 3 de la especificación: botón de WhatsApp junto al alumno moroso -- genera el texto de cobranza y el link `wa.me`, y deja constancia en `mensajes_cobranza_whatsapp`. */
export async function generarMensajeWhatsappAction(estudianteId: number): Promise<MensajeWhatsappResultado> {
  try {
    const resultado = await generarYRegistrarMensajeCobranza(prisma, estudianteId);
    return {
      ok: true,
      linkWhatsapp: resultado.linkWhatsapp,
      mensajeTexto: resultado.mensajeTexto,
      telefonoTutor: resultado.telefonoTutor,
    };
  } catch (e) {
    return { ok: false, mensaje: e instanceof Error ? e.message : "Error inesperado generando el mensaje de cobranza." };
  }
}

export interface OpcionCuentaIngreso {
  codigo: string;
  nombre: string;
}

/** Cuentas DETALLE de Ingreso del libro COLEGIO -- para el selector de "Otros ingresos" (uniformes, certificados, etc.). */
export async function listarCuentasDeIngresoAction(): Promise<OpcionCuentaIngreso[]> {
  const cuentas = await prisma.catalogoCuenta.findMany({
    where: { libro: "COLEGIO", tipoCuenta: "DETALLE", clase: "INGRESO", activo: true },
    orderBy: { codigo: "asc" },
  });
  return cuentas.map((c) => ({ codigo: c.codigo, nombre: c.nombre }));
}
