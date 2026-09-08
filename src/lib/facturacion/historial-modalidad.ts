import type { PrismaClient, Modalidad } from "@prisma/client";

/**
 * Devuelve la Modalidad que le correspondía a un estudiante en una fecha
 * concreta (no necesariamente la de HOY). Esto es lo que hace posible la
 * "Flexibilidad Económica": si Eduardo cambia a un alumno de Secundaria
 * Técnica a Secundaria Regular a mitad de año, los meses YA facturados
 * (con la tarifa técnica) no cambian, pero los meses siguientes se facturan
 * automáticamente con la tarifa regular, porque cada mes consulta CUÁL
 * modalidad estaba vigente ESE mes específico.
 *
 * Si el estudiante no tiene ningún registro en `historial_modalidad`
 * (el caso normal para un alumno que nunca ha cambiado de modalidad), se
 * usa simplemente su `modalidadId` actual -- así no hace falta crear un
 * historial para cada alumno, solo para los que de verdad cambian.
 */
export async function obtenerModalidadVigente(
  prisma: PrismaClient,
  estudianteId: number,
  modalidadActualId: number,
  fecha: Date
): Promise<Modalidad> {
  const vigente = await prisma.historialModalidad.findFirst({
    where: {
      estudianteId,
      vigenteDesde: { lte: fecha },
      OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: fecha } }],
    },
    include: { modalidad: true },
    orderBy: { vigenteDesde: "desc" },
  });
  if (vigente) return vigente.modalidad;

  // Sin historial para esa fecha: se usa la modalidad actual de la ficha.
  return prisma.modalidad.findUniqueOrThrow({ where: { id: modalidadActualId } });
}

/**
 * Registra un cambio de modalidad a partir de una fecha (ej. "de Secundaria
 * Técnica a Secundaria Regular desde el 1 de octubre por motivos
 * económicos"). Cierra automáticamente el tramo anterior (le pone
 * `vigenteHasta` al día previo) y actualiza `Estudiante.modalidadId` para
 * que la ficha siempre muestre la modalidad ACTUAL.
 */
export async function cambiarModalidadEstudiante(
  prisma: PrismaClient,
  params: { estudianteId: number; nuevaModalidadId: number; vigenteDesde: Date; motivo?: string }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const estudiante = await tx.estudiante.findUniqueOrThrow({ where: { id: params.estudianteId } });

    // Si no había ningún registro de historial todavía, se crea uno para la
    // modalidad ANTERIOR (la que tenía la ficha hasta ahora), para no perder
    // el rastro de con qué modalidad se facturaron los meses ya pasados.
    const tieneHistorial = await tx.historialModalidad.findFirst({ where: { estudianteId: params.estudianteId } });
    if (!tieneHistorial) {
      const undiaAntes = new Date(params.vigenteDesde);
      undiaAntes.setUTCDate(undiaAntes.getUTCDate() - 1);
      await tx.historialModalidad.create({
        data: {
          estudianteId: params.estudianteId,
          modalidadId: estudiante.modalidadId,
          vigenteDesde: new Date(Date.UTC(params.vigenteDesde.getUTCFullYear(), 0, 1)),
          vigenteHasta: undiaAntes,
          motivo: "Modalidad con la que inició el año (registrada automáticamente al primer cambio).",
        },
      });
    } else {
      // Cierra el tramo que estaba abierto (vigenteHasta: null).
      const undiaAntes = new Date(params.vigenteDesde);
      undiaAntes.setUTCDate(undiaAntes.getUTCDate() - 1);
      await tx.historialModalidad.updateMany({
        where: { estudianteId: params.estudianteId, vigenteHasta: null },
        data: { vigenteHasta: undiaAntes },
      });
    }

    await tx.historialModalidad.create({
      data: {
        estudianteId: params.estudianteId,
        modalidadId: params.nuevaModalidadId,
        vigenteDesde: params.vigenteDesde,
        motivo: params.motivo,
      },
    });

    await tx.estudiante.update({
      where: { id: params.estudianteId },
      data: { modalidadId: params.nuevaModalidadId },
    });
  });
}
