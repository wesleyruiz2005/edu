/**
 * Exportaciones a Excel específicas del Dashboard de la Junta (punto 4):
 * Top de morosidad por sección, niños ICCM "Retenidos" del mes (auditoría),
 * y comisiones bancarias BAC del año.
 */
import type { SeccionMorosidad } from "../reportes/morosidad";
import type { NinoRetenidoAuditoria, ComisionBacMes } from "../reportes/iccm-auditoria";
import { crearHoja, crearLibro, libroABase64, nombreDeArchivoSeguro } from "./excel";

export function exportarTopMorosidad(filas: SeccionMorosidad[]): { base64: string; nombreArchivo: string } {
  const hoja = crearHoja(filas, [
    { header: "Colegio", ancho: 26, valor: (f) => f.colegioNombre },
    { header: "Nivel Académico", ancho: 20, valor: (f) => f.nivelAcademico },
    { header: "Sección", ancho: 16, valor: (f) => f.seccionNombre },
    { header: "Total Vencido", ancho: 15, valor: (f) => f.totalVencido },
    { header: "Alumnos con Cargos Vencidos", ancho: 22, valor: (f) => f.cantidadAlumnosVencidos },
  ]);
  const libro = crearLibro([{ nombre: "Top Morosidad por Sección", hoja }]);
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro("Top_Morosidad_Secciones")}.xlsx` };
}

export function exportarNinosRetenidosIccm(ninos: NinoRetenidoAuditoria[], etiquetaPeriodo: string): { base64: string; nombreArchivo: string } {
  const hoja = crearHoja(ninos, [
    { header: "Código NC", ancho: 16, valor: (n) => n.codigoNc },
    { header: "Nombre", ancho: 32, valor: (n) => n.nombreCompleto },
    { header: "Motivo de Retención", ancho: 24, valor: (n) => n.motivoRetencion ?? "" },
    { header: "Monto Base (US$)", ancho: 16, valor: (n) => n.montoBase },
  ]);
  const libro = crearLibro([{ nombre: "ICCM - Retenidos", hoja }]);
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`ICCM_Retenidos_${etiquetaPeriodo}`)}.xlsx` };
}

const MESES_CORTOS = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function exportarComisionesBac(comisiones: ComisionBacMes[], anio: number): { base64: string; nombreArchivo: string } {
  const hoja = crearHoja(comisiones, [
    { header: "Mes", ancho: 12, valor: (c) => MESES_CORTOS[c.mes] },
    { header: "Comisión BAC Nacional (US$)", ancho: 22, valor: (c) => c.comisionBacNacional },
    { header: "Registrada", ancho: 12, valor: (c) => (c.comisionBacRegistrada ? "Sí" : "No") },
  ]);
  const total = comisiones.reduce((s, c) => s + c.comisionBacNacional, 0);
  const hojaResumen = crearHoja(
    [
      { etiqueta: "Año", valor: anio },
      { etiqueta: "Total Comisiones BAC del Año (US$)", valor: Math.round((total + Number.EPSILON) * 100) / 100 },
    ],
    [
      { header: "Concepto", ancho: 30, valor: (r) => r.etiqueta },
      { header: "Valor", ancho: 20, valor: (r) => r.valor },
    ]
  );
  const libro = crearLibro([
    { nombre: "Resumen", hoja: hojaResumen },
    { nombre: "Comisiones BAC por Mes", hoja },
  ]);
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`Comisiones_BAC_${anio}`)}.xlsx` };
}
