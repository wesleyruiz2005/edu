/**
 * "Top 5 de secciones con mayor morosidad" del Dashboard de la Junta
 * Directiva (punto 4). Agrupa los cargos VENCIDOS (saldoPendiente > 0 y
 * fechaVencimiento ya pasó) por sección, sumando el saldo vencido y contando
 * cuántos alumnos distintos de esa sección están afectados.
 */
import type { PrismaClient } from "@prisma/client";

export interface SeccionMorosidad {
  colegioNombre: string;
  nivelAcademico: string;
  seccionNombre: string;
  totalVencido: number;
  cantidadAlumnosVencidos: number;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function obtenerTopSeccionesMorosidad(
  prisma: PrismaClient,
  opciones?: { colegioId?: number; limite?: number }
): Promise<SeccionMorosidad[]> {
  const hoy = new Date();
  const cargosVencidos = await prisma.cargoEstudiante.findMany({
    where: {
      saldoPendiente: { gt: 0 },
      fechaVencimiento: { lt: hoy },
      ...(opciones?.colegioId ? { estudiante: { colegioId: opciones.colegioId } } : {}),
    },
    include: { estudiante: { include: { seccion: true, nivelAcademico: true, colegio: true } } },
  });

  interface Acumulado {
    colegioNombre: string;
    nivelAcademico: string;
    seccionNombre: string;
    totalVencido: number;
    alumnos: Set<number>;
  }
  const mapa = new Map<string, Acumulado>();

  for (const c of cargosVencidos) {
    const seccionNombre = c.estudiante.seccion?.nombreSeccion ?? "Sin sección";
    const key = `${c.estudiante.colegioId}-${c.estudiante.nivelAcademicoId}-${seccionNombre}`;
    const monto = c.saldoPendiente.toNumber();
    const existente = mapa.get(key);
    if (existente) {
      existente.totalVencido += monto;
      existente.alumnos.add(c.estudiante.id);
    } else {
      mapa.set(key, {
        colegioNombre: c.estudiante.colegio.nombre,
        nivelAcademico: c.estudiante.nivelAcademico.nombre,
        seccionNombre,
        totalVencido: monto,
        alumnos: new Set([c.estudiante.id]),
      });
    }
  }

  const filas: SeccionMorosidad[] = Array.from(mapa.values())
    .map((v) => ({
      colegioNombre: v.colegioNombre,
      nivelAcademico: v.nivelAcademico,
      seccionNombre: v.seccionNombre,
      totalVencido: redondear(v.totalVencido),
      cantidadAlumnosVencidos: v.alumnos.size,
    }))
    .sort((a, b) => b.totalVencido - a.totalVencido);

  return filas.slice(0, opciones?.limite ?? 5);
}
