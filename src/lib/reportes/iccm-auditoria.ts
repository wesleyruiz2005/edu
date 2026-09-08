/**
 * "Sección Especial ICCM" del Dashboard de la Junta (punto 4): tabla de
 * niños en estado "Retenido" (por falta de foto/carta) para auditoría
 * inmediata, y el desglose de las comisiones bancarias BAC registradas mes a
 * mes -- ambas ya existían como tablas (`IccmAsignacionMensual`,
 * `IccmConciliacionMensual`), este archivo solo las arma como reporte
 * listo para pantalla/Excel.
 */
import type { PrismaClient } from "@prisma/client";

export interface NinoRetenidoAuditoria {
  codigoNc: string;
  nombreCompleto: string;
  motivoRetencion: string | null;
  montoBase: number;
}

export async function obtenerNinosRetenidosDelMes(
  prisma: PrismaClient,
  params: { anio: number; mes: number }
): Promise<NinoRetenidoAuditoria[]> {
  const asignaciones = await prisma.iccmAsignacionMensual.findMany({
    where: { anio: params.anio, mes: params.mes, estadoRetencion: "RETENIDO" },
    include: { nino: true },
    orderBy: { nino: { nombreCompleto: "asc" } },
  });
  return asignaciones.map((a) => ({
    codigoNc: a.nino.codigoNc,
    nombreCompleto: a.nino.nombreCompleto,
    motivoRetencion: a.motivoRetencion,
    montoBase: a.montoBase.toNumber(),
  }));
}

export interface ComisionBacMes {
  mes: number;
  comisionBacNacional: number;
  comisionBacRegistrada: boolean;
}

export async function obtenerComisionesBacDelAnio(prisma: PrismaClient, anio: number): Promise<ComisionBacMes[]> {
  const conciliaciones = await prisma.iccmConciliacionMensual.findMany({
    where: { anio },
    orderBy: { mes: "asc" },
  });
  return conciliaciones.map((c) => ({
    mes: c.mes,
    comisionBacNacional: c.comisionBacNacional?.toNumber() ?? 0,
    comisionBacRegistrada: c.comisionBacRegistrada,
  }));
}
