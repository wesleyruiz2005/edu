/**
 * ============================================================================
 * EXPORTACIÓN DE NÓMINA A EXCEL (punto 1 de la especificación, 7 sept 2026)
 * ============================================================================
 * "Generá la función para exportar la nómina consolidada y desglosada por
 * empleado directamente a Excel, respetando las columnas de salario bruto,
 * deducciones (INSS/IR) y neto a recibir." Sirve para las 5 combinaciones de
 * `TipoNomina` (El Mesías/Instituto personal fijo, Instituto por servicios,
 * El Buen Pastor INSS/No-INSS) -- todas comparten la misma `PlanillaDetalle`.
 */
import type { PrismaClient } from "@prisma/client";
import { crearHoja, crearLibro, libroABase64, nombreDeArchivoSeguro } from "../exportar/excel";

export interface FilaNominaExport {
  nombreCompleto: string;
  cedula: string;
  cargo: string;
  salarioBruto: number;
  inssLaboral: number;
  inssPatronal: number;
  inatecPatronal: number;
  irMensual: number;
  subsidioInssPiso: number;
  porcentajeRetencion: number;
  montoRetencion: number;
  salarioNeto: number;
}

export interface PlanillaParaExportar {
  colegioNombre: string;
  tipoNomina: string;
  anio: number;
  mes: number;
  filas: FilaNominaExport[];
}

const NOMBRES_TIPO_NOMINA: Record<string, string> = {
  DOCENTE_HORARIO: "Docente por Hora (Servicio Profesional)",
  CONTRATO_SERVICIOS_GENERALES: "Contrato Servicios Generales",
  PERSONAL_FIJO: "Personal Fijo",
  DOCENTE_INSS: "Personal Inscrito al INSS",
  DOCENTE_NO_INSS: "Personal No Inscrito al INSS",
};

const MESES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** Trae la planilla + su detalle por empleado, ya en números planos (nada de BigInt/Decimal) para exportar. */
export async function obtenerPlanillaParaExportar(prisma: PrismaClient, planillaId: number): Promise<PlanillaParaExportar> {
  const planilla = await prisma.planillaMensual.findUniqueOrThrow({
    where: { id: planillaId },
    include: {
      colegio: true,
      detalle: { include: { empleado: true }, orderBy: { empleado: { nombreCompleto: "asc" } } },
    },
  });

  return {
    colegioNombre: planilla.colegio.nombre,
    tipoNomina: planilla.tipoNomina,
    anio: planilla.anio,
    mes: planilla.mes,
    filas: planilla.detalle.map((d) => ({
      nombreCompleto: d.empleado.nombreCompleto,
      cedula: d.empleado.cedula ?? "",
      cargo: d.empleado.cargo ?? "",
      salarioBruto: d.salarioBruto.toNumber(),
      inssLaboral: d.inssLaboral.toNumber(),
      inssPatronal: d.inssPatronal.toNumber(),
      inatecPatronal: d.inatecPatronal.toNumber(),
      irMensual: d.irMensual.toNumber(),
      subsidioInssPiso: d.subsidioInssPiso.toNumber(),
      porcentajeRetencion: d.porcentajeRetencion.toNumber(),
      montoRetencion: d.montoRetencion.toNumber(),
      salarioNeto: d.salarioNeto.toNumber(),
    })),
  };
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Arma el .xlsx: hoja "Resumen" (totales consolidados) + hoja "Detalle por Empleado" (bruto/deducciones/neto). */
export function exportarPlanillaAExcel(planilla: PlanillaParaExportar): { base64: string; nombreArchivo: string } {
  const tituloTipo = NOMBRES_TIPO_NOMINA[planilla.tipoNomina] ?? planilla.tipoNomina;

  const hojaDetalle = crearHoja(planilla.filas, [
    { header: "Empleado", ancho: 32, valor: (f) => f.nombreCompleto },
    { header: "Cédula", ancho: 16, valor: (f) => f.cedula },
    { header: "Cargo", ancho: 22, valor: (f) => f.cargo },
    { header: "Salario Bruto", ancho: 15, valor: (f) => f.salarioBruto },
    { header: "INSS Laboral (7%)", ancho: 15, valor: (f) => f.inssLaboral },
    { header: "IR Mensual", ancho: 13, valor: (f) => f.irMensual },
    { header: "% Retención Servicios", ancho: 16, valor: (f) => f.porcentajeRetencion },
    { header: "Retención Servicios", ancho: 16, valor: (f) => f.montoRetencion },
    { header: "Total Deducido", ancho: 15, valor: (f) => redondear(f.inssLaboral + f.irMensual + f.montoRetencion) },
    { header: "Neto a Recibir", ancho: 15, valor: (f) => f.salarioNeto },
    { header: "INSS Patronal (Gasto)", ancho: 18, valor: (f) => f.inssPatronal },
    { header: "INATEC Patronal (Gasto)", ancho: 18, valor: (f) => f.inatecPatronal },
    { header: "Subsidio Piso INSS (Gasto)", ancho: 22, valor: (f) => f.subsidioInssPiso },
  ]);

  const totales = planilla.filas.reduce(
    (acc, f) => ({
      salarioBruto: acc.salarioBruto + f.salarioBruto,
      inssLaboral: acc.inssLaboral + f.inssLaboral,
      inssPatronal: acc.inssPatronal + f.inssPatronal,
      inatecPatronal: acc.inatecPatronal + f.inatecPatronal,
      irMensual: acc.irMensual + f.irMensual,
      subsidioInssPiso: acc.subsidioInssPiso + f.subsidioInssPiso,
      montoRetencion: acc.montoRetencion + f.montoRetencion,
      salarioNeto: acc.salarioNeto + f.salarioNeto,
    }),
    { salarioBruto: 0, inssLaboral: 0, inssPatronal: 0, inatecPatronal: 0, irMensual: 0, subsidioInssPiso: 0, montoRetencion: 0, salarioNeto: 0 }
  );

  const filasResumen = [
    { etiqueta: "Colegio", valor: planilla.colegioNombre },
    { etiqueta: "Tipo de Nómina", valor: tituloTipo },
    { etiqueta: "Periodo", valor: `${MESES[planilla.mes]} ${planilla.anio}` },
    { etiqueta: "Cantidad de Empleados", valor: planilla.filas.length },
    { etiqueta: "", valor: "" },
    { etiqueta: "Total Salario Bruto", valor: redondear(totales.salarioBruto) },
    { etiqueta: "Total INSS Laboral (deducido al empleado)", valor: redondear(totales.inssLaboral) },
    { etiqueta: "Total IR Mensual (deducido al empleado)", valor: redondear(totales.irMensual) },
    { etiqueta: "Total Retención de Servicios (deducido)", valor: redondear(totales.montoRetencion) },
    { etiqueta: "TOTAL NETO PAGADO", valor: redondear(totales.salarioNeto) },
    { etiqueta: "Total INSS Patronal (gasto adicional)", valor: redondear(totales.inssPatronal) },
    { etiqueta: "Total INATEC Patronal (gasto adicional)", valor: redondear(totales.inatecPatronal) },
    { etiqueta: "Total Subsidio Piso INSS (gasto adicional, El Buen Pastor)", valor: redondear(totales.subsidioInssPiso) },
  ];

  const hojaResumen = crearHoja(filasResumen, [
    { header: "Concepto", ancho: 44, valor: (r) => r.etiqueta },
    { header: "Valor", ancho: 20, valor: (r) => r.valor },
  ]);

  const libro = crearLibro([
    { nombre: "Resumen", hoja: hojaResumen },
    { nombre: "Detalle por Empleado", hoja: hojaDetalle },
  ]);

  const nombreArchivo = `${nombreDeArchivoSeguro(`Nomina_${planilla.colegioNombre}_${planilla.tipoNomina}_${planilla.anio}-${String(planilla.mes).padStart(2, "0")}`)}.xlsx`;
  return { base64: libroABase64(libro), nombreArchivo };
}
