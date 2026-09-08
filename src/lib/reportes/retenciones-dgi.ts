/**
 * ============================================================================
 * MÓDULO ESPECIAL DE RETENCIONES MENSUALES PARA PAGO DE IMPUESTOS (DGI)
 * ============================================================================
 * Punto 2 de la especificación (7 sept 2026): reporte indispensable para la
 * declaración y el pago mensual ante la DGI. Jala automáticamente, del mes
 * seleccionado:
 *   1. Las retenciones 2%/10% aplicadas a proveedores en el Módulo de
 *      Egresos (`PagoProveedor.montoRetencion`).
 *   2. Las retenciones 10% aplicadas a los docentes por hora en el Módulo de
 *      Nóminas (`PlanillaDetalle.montoRetencion` de una planilla
 *      `DOCENTE_HORARIO`).
 *
 * Nota de alcance (avisar a Eduardo): el Módulo de Nóminas también calcula
 * una retención del 2% a `CONTRATO_SERVICIOS_GENERALES` (contratos por
 * servicios generales del Instituto) -- Eduardo solo pidió explícitamente
 * incluir la de "docentes por hora" (10%) en este reporte, así que por ahora
 * NO se incluye la de contratos de servicios generales de nómina. Se deja
 * este comentario a propósito: si Eduardo confirma que también debe entrar
 * a la declaración de la DGI, es un cambio de una línea (agregar ese
 * `tipoNomina` al filtro de `planillasRelevantes` más abajo).
 */
import type { PrismaClient } from "@prisma/client";
import { crearHoja, crearLibro, libroABase64, nombreDeArchivoSeguro } from "../exportar/excel";

export interface RenglonRetencionDgi {
  fecha: string; // ISO
  tipo: "PROVEEDOR" | "DOCENTE_POR_HORA";
  colegioNombre: string;
  nombre: string;
  rucCedula: string;
  numeroDocumento: string; // # Factura o # Planilla
  montoBase: number;
  porcentajeRetencion: number;
  montoRetencion: number;
}

export interface ReporteRetencionesDgi {
  anio: number;
  mes: number;
  renglones: RenglonRetencionDgi[];
  totalRetencion2PorcientoProveedores: number;
  totalRetencion10PorcientoProveedores: number;
  totalRetencion10PorcientoDocentes: number;
  totalGeneral: number;
}

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function obtenerRetencionesDgiDelMes(
  prisma: PrismaClient,
  params: { anio: number; mes: number; colegioId?: number }
): Promise<ReporteRetencionesDgi> {
  const desde = new Date(Date.UTC(params.anio, params.mes - 1, 1));
  const hasta = new Date(Date.UTC(params.anio, params.mes, 1));

  // --- 1) Retenciones a proveedores (Módulo de Egresos) ---
  const pagos = await prisma.pagoProveedor.findMany({
    where: {
      fechaPago: { gte: desde, lt: hasta },
      montoRetencion: { gt: 0 },
      ...(params.colegioId ? { colegioId: params.colegioId } : {}),
    },
    include: { proveedor: true, colegio: true },
    orderBy: { fechaPago: "asc" },
  });

  const renglonesProveedor: RenglonRetencionDgi[] = pagos.map((p) => ({
    fecha: p.fechaPago.toISOString(),
    tipo: "PROVEEDOR",
    colegioNombre: p.colegio.nombre,
    nombre: p.proveedor.nombreCompleto,
    rucCedula: p.proveedor.rucCedula ?? "",
    numeroDocumento: p.numeroFactura ?? p.numeroComprobantePago,
    montoBase:
      p.tipoGasto === "COMPRA_O_SERVICIO_GENERAL" ? (p.baseImponibleSinIva?.toNumber() ?? p.montoFactura.toNumber()) : p.montoFactura.toNumber(),
    porcentajeRetencion: p.porcentajeRetencionAplicado.toNumber(),
    montoRetencion: p.montoRetencion.toNumber(),
  }));

  // --- 2) Retenciones a docentes por hora (Módulo de Nóminas, DOCENTE_HORARIO) ---
  const planillasRelevantes = await prisma.planillaMensual.findMany({
    where: {
      anio: params.anio,
      mes: params.mes,
      tipoNomina: "DOCENTE_HORARIO",
      ...(params.colegioId ? { colegioId: params.colegioId } : {}),
    },
    include: { colegio: true, comprobante: true, detalle: { include: { empleado: true } } },
  });

  const renglonesDocentes: RenglonRetencionDgi[] = [];
  for (const planilla of planillasRelevantes) {
    const fechaReferencia = planilla.comprobante?.fecha ?? new Date(Date.UTC(params.anio, params.mes - 1, 28));
    for (const d of planilla.detalle) {
      if (d.montoRetencion.toNumber() <= 0) continue;
      renglonesDocentes.push({
        fecha: fechaReferencia.toISOString(),
        tipo: "DOCENTE_POR_HORA",
        colegioNombre: planilla.colegio.nombre,
        nombre: d.empleado.nombreCompleto,
        rucCedula: d.empleado.cedula ?? "",
        numeroDocumento: `Planilla Docente Horario ${String(planilla.mes).padStart(2, "0")}/${planilla.anio}`,
        montoBase: d.salarioBruto.toNumber(),
        porcentajeRetencion: d.porcentajeRetencion.toNumber(),
        montoRetencion: d.montoRetencion.toNumber(),
      });
    }
  }

  const renglones = [...renglonesProveedor, ...renglonesDocentes].sort((a, b) => a.fecha.localeCompare(b.fecha));

  const totalRetencion2PorcientoProveedores = redondear(
    renglonesProveedor.filter((r) => r.porcentajeRetencion === 2).reduce((s, r) => s + r.montoRetencion, 0)
  );
  const totalRetencion10PorcientoProveedores = redondear(
    renglonesProveedor.filter((r) => r.porcentajeRetencion === 10).reduce((s, r) => s + r.montoRetencion, 0)
  );
  const totalRetencion10PorcientoDocentes = redondear(renglonesDocentes.reduce((s, r) => s + r.montoRetencion, 0));
  const totalGeneral = redondear(totalRetencion2PorcientoProveedores + totalRetencion10PorcientoProveedores + totalRetencion10PorcientoDocentes);

  return {
    anio: params.anio,
    mes: params.mes,
    renglones,
    totalRetencion2PorcientoProveedores,
    totalRetencion10PorcientoProveedores,
    totalRetencion10PorcientoDocentes,
    totalGeneral,
  };
}

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

/** Exporta el reporte a Excel EXACTAMENTE con las columnas que pidió Eduardo: Fecha, Nombre, RUC/Cédula, #Factura/Planilla, Monto Base, Monto de Retención. */
export function exportarRetencionesDgiAExcel(reporte: ReporteRetencionesDgi): { base64: string; nombreArchivo: string } {
  const hojaDetalle = crearHoja(reporte.renglones, [
    { header: "Fecha", ancho: 12, valor: (r) => r.fecha.slice(0, 10) },
    { header: "Tipo", ancho: 16, valor: (r) => (r.tipo === "PROVEEDOR" ? "Proveedor" : "Docente por Hora") },
    { header: "Colegio", ancho: 26, valor: (r) => r.colegioNombre },
    { header: "Nombre del Proveedor/Docente", ancho: 32, valor: (r) => r.nombre },
    { header: "RUC/Cédula", ancho: 18, valor: (r) => r.rucCedula },
    { header: "# Factura/Planilla", ancho: 26, valor: (r) => r.numeroDocumento },
    { header: "Monto Base", ancho: 15, valor: (r) => r.montoBase },
    { header: "% Retención", ancho: 12, valor: (r) => r.porcentajeRetencion },
    { header: "Monto de Retención Aplicado", ancho: 20, valor: (r) => r.montoRetencion },
  ]);

  const hojaResumen = crearHoja(
    [
      { etiqueta: "Periodo", valor: `${MESES[reporte.mes]} ${reporte.anio}` },
      { etiqueta: "Retenciones 2% a proveedores (compra/servicio general)", valor: reporte.totalRetencion2PorcientoProveedores },
      { etiqueta: "Retenciones 10% a proveedores (servicio profesional)", valor: reporte.totalRetencion10PorcientoProveedores },
      { etiqueta: "Retenciones 10% a docentes por hora (nómina)", valor: reporte.totalRetencion10PorcientoDocentes },
      { etiqueta: "TOTAL A DECLARAR/PAGAR A LA DGI", valor: reporte.totalGeneral },
    ],
    [
      { header: "Concepto", ancho: 48, valor: (r) => r.etiqueta },
      { header: "Monto", ancho: 20, valor: (r) => r.valor },
    ]
  );

  const libro = crearLibro([
    { nombre: "Resumen", hoja: hojaResumen },
    { nombre: "Retenciones DGI", hoja: hojaDetalle },
  ]);

  const nombreArchivo = `${nombreDeArchivoSeguro(`Retenciones_DGI_${reporte.anio}-${String(reporte.mes).padStart(2, "0")}`)}.xlsx`;
  return { base64: libroABase64(libro), nombreArchivo };
}
