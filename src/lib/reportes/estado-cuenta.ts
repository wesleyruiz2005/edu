/**
 * ============================================================================
 * ESTADO DE CUENTA ESTUDIANTIL -- soporte de la Pantalla de Cajera
 * ============================================================================
 * Punto 3a de la especificación: "vista individual por alumno cruzando lo
 * facturado contra lo pagado, mostrando saldos vencidos". Esta consulta es
 * lo primero que corre cuando la cajera busca a un alumno por su Código NC
 * (o el código interno del colegio) -- de ahí sale tanto la alerta de mora
 * como la lista de aranceles que se pueden cobrar en el ROC.
 */
import type { PrismaClient } from "@prisma/client";

export interface CargoPendiente {
  cargoId: string; // BigInt serializado (los Server Actions no pueden devolver BigInt tal cual)
  concepto: string;
  anioLectivo: number;
  mes: number | null;
  montoFacturado: number;
  recargoMoraMonto: number;
  montoPagadoAcumulado: number;
  saldoPendiente: number;
  fechaVencimiento: string; // ISO, para que el cliente la formatee
  estado: string;
  vencido: boolean;
}

export interface EstadoCuentaEstudiante {
  estudianteId: number;
  codigoEstudiantil: string;
  nombreCompleto: string;
  nivelAcademico: string;
  seccion: string | null;
  nombreTutor: string;
  /** Para el Módulo de Cobranza WhatsApp (punto 3) -- null si el alumno no tiene teléfono de tutor registrado. */
  telefonoTutor: string | null;
  colegioNombre: string;
  codigoIccm: string | null;
  cargosPendientes: CargoPendiente[];
  saldoTotalPendiente: number;
  saldoVencido: number;
  mesesVencidos: number;
}

/**
 * Busca un alumno por su código estudiantil (Código NC / código interno del
 * colegio, ej. "CMLM-2026-001", "ITML-2026-035") DENTRO de un colegio, y
 * arma su estado de cuenta completo: todos los cargos con saldo pendiente
 * (de cualquier año lectivo, no solo el actual), marcando cuáles ya están
 * vencidos.
 */
export async function buscarEstudianteConEstadoDeCuenta(
  prisma: PrismaClient,
  colegioId: number,
  codigoEstudiantil: string
): Promise<EstadoCuentaEstudiante | null> {
  const estudiante = await prisma.estudiante.findFirst({
    where: {
      colegioId,
      codigoEstudiantil: { equals: codigoEstudiantil.trim(), mode: "insensitive" },
    },
    include: { nivelAcademico: true, seccion: true, colegio: true },
  });
  if (!estudiante) return null;

  const hoy = new Date();
  const cargos = await prisma.cargoEstudiante.findMany({
    where: { estudianteId: estudiante.id, saldoPendiente: { gt: 0 } },
    include: { concepto: true, anioLectivo: true },
    orderBy: [{ anioLectivo: { anio: "asc" } }, { mes: "asc" }],
  });

  const cargosPendientes: CargoPendiente[] = cargos.map((c) => {
    const vencido = c.fechaVencimiento.getTime() < hoy.getTime();
    return {
      cargoId: c.id.toString(),
      concepto: c.concepto.nombre,
      anioLectivo: c.anioLectivo.anio,
      mes: c.mes,
      montoFacturado: c.montoFacturado.toNumber(),
      recargoMoraMonto: c.recargoMoraMonto.toNumber(),
      montoPagadoAcumulado: c.montoPagadoAcumulado.toNumber(),
      saldoPendiente: c.saldoPendiente.toNumber(),
      fechaVencimiento: c.fechaVencimiento.toISOString(),
      estado: c.estado,
      vencido,
    };
  });

  const saldoTotalPendiente = Math.round((cargosPendientes.reduce((s, c) => s + c.saldoPendiente, 0) + Number.EPSILON) * 100) / 100;
  const vencidos = cargosPendientes.filter((c) => c.vencido);
  const saldoVencido = Math.round((vencidos.reduce((s, c) => s + c.saldoPendiente, 0) + Number.EPSILON) * 100) / 100;

  return {
    estudianteId: estudiante.id,
    codigoEstudiantil: estudiante.codigoEstudiantil,
    nombreCompleto: estudiante.nombreCompleto,
    nivelAcademico: estudiante.nivelAcademico.nombre,
    seccion: estudiante.seccion?.nombreSeccion ?? null,
    nombreTutor: estudiante.nombreTutor,
    telefonoTutor: estudiante.telefonoTutor,
    colegioNombre: estudiante.colegio.nombre,
    codigoIccm: estudiante.codigoIccm,
    cargosPendientes,
    saldoTotalPendiente,
    saldoVencido,
    mesesVencidos: vencidos.length,
  };
}
