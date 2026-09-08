/**
 * ============================================================================
 * EXPORTACIÓN A EXCEL DE LOS 5 ESTADOS FINANCIEROS (punto 4, Dashboard Junta)
 * ============================================================================
 * "Habilitá botones de descarga global e individual para exportar
 * inmediatamente a Excel en formatos formales y limpios: Balance General,
 * Estado de Resultados, Balanza de Comprobación, Libro Diario y Libro
 * Mayor." Cada función recibe el objeto YA calculado por su reporte
 * correspondiente (`src/lib/reportes/*`) -- así no duplica ninguna lógica
 * contable, solo lo convierte a hojas de Excel.
 */
import type { ResultadoBalanza } from "../reportes/balanza-comprobacion";
import type { EstadoResultados } from "../reportes/estado-resultados";
import type { BalanceGeneral } from "../reportes/balance-general";
import type { AsientoLibroDiario } from "../reportes/libro-diario";
import type { LibroMayorCuenta } from "../reportes/libro-mayor";
import { crearHoja, crearLibro, libroABase64, nombreDeArchivoSeguro } from "./excel";

export function exportarBalanzaComprobacion(balanza: ResultadoBalanza, etiquetaPeriodo: string): { base64: string; nombreArchivo: string } {
  const hoja = crearHoja(balanza.renglones, [
    { header: "Código", ancho: 12, valor: (r) => r.cuentaCodigo },
    { header: "Cuenta", ancho: 38, valor: (r) => r.cuentaNombre },
    { header: "Clase", ancho: 14, valor: (r) => r.clase },
    { header: "Saldo Inicial", ancho: 14, valor: (r) => r.saldoInicial },
    { header: "Debe Acumulado", ancho: 15, valor: (r) => r.debeAcumulado },
    { header: "Haber Acumulado", ancho: 15, valor: (r) => r.haberAcumulado },
    { header: "Saldo Final", ancho: 14, valor: (r) => r.saldoFinal },
  ]);
  const hojaResumen = crearHoja(
    [
      { etiqueta: "Periodo", valor: etiquetaPeriodo },
      { etiqueta: "Total Debe", valor: balanza.totalDebe },
      { etiqueta: "Total Haber", valor: balanza.totalHaber },
      { etiqueta: "Estado", valor: balanza.cuadrado ? "OK - Cuadrado" : "DESCUADRADO -- REVISAR" },
    ],
    [
      { header: "Concepto", ancho: 20, valor: (r) => r.etiqueta },
      { header: "Valor", ancho: 24, valor: (r) => r.valor },
    ]
  );
  const libro = crearLibro([
    { nombre: "Resumen", hoja: hojaResumen },
    { nombre: "Balanza de Comprobación", hoja },
  ]);
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`Balanza_Comprobacion_${etiquetaPeriodo}`)}.xlsx` };
}

export function exportarEstadoResultados(er: EstadoResultados, etiquetaColegio: string): { base64: string; nombreArchivo: string } {
  interface Fila {
    seccion: string;
    codigo: string;
    nombre: string;
    monto: number;
  }
  const filas: Fila[] = [
    ...er.ingresos.map((l) => ({ seccion: "Ingresos", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "TOTAL INGRESOS", monto: er.totalIngresos },
    ...er.costos.map((l) => ({ seccion: "Costos", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "TOTAL COSTOS", monto: er.totalCostos },
    { seccion: "", codigo: "", nombre: "UTILIDAD BRUTA", monto: er.utilidadBruta },
    ...er.gastos.map((l) => ({ seccion: "Gastos", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "TOTAL GASTOS", monto: er.totalGastos },
    { seccion: "", codigo: "", nombre: "UTILIDAD NETA DEL PERIODO", monto: er.utilidadNeta },
  ];
  const hoja = crearHoja(filas, [
    { header: "Sección", ancho: 12, valor: (f) => f.seccion },
    { header: "Código", ancho: 12, valor: (f) => f.codigo },
    { header: "Cuenta", ancho: 40, valor: (f) => f.nombre },
    { header: "Monto", ancho: 16, valor: (f) => f.monto },
  ]);
  const libro = crearLibro([{ nombre: "Estado de Resultados", hoja }]);
  const etiquetaPeriodo = `${etiquetaColegio}_${er.anio}-${String(er.mesHasta).padStart(2, "0")}`;
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`Estado_Resultados_${etiquetaPeriodo}`)}.xlsx` };
}

export function exportarBalanceGeneral(bg: BalanceGeneral, etiquetaColegio: string): { base64: string; nombreArchivo: string } {
  interface Fila {
    seccion: string;
    codigo: string;
    nombre: string;
    monto: number;
  }
  const filas: Fila[] = [
    ...bg.activos.map((l) => ({ seccion: "Activo", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "TOTAL ACTIVO", monto: bg.totalActivo },
    ...bg.pasivos.map((l) => ({ seccion: "Pasivo", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "TOTAL PASIVO", monto: bg.totalPasivo },
    ...bg.patrimonio.map((l) => ({ seccion: "Patrimonio", codigo: l.cuentaCodigo, nombre: l.cuentaNombre, monto: l.monto })),
    { seccion: "", codigo: "", nombre: "Utilidad del Periodo (Estado de Resultados)", monto: bg.utilidadDelPeriodo },
    { seccion: "", codigo: "", nombre: "TOTAL PATRIMONIO", monto: bg.totalPatrimonio },
    { seccion: "", codigo: "", nombre: "TOTAL PASIVO + PATRIMONIO", monto: bg.totalPasivoMasPatrimonio },
    { seccion: "", codigo: "", nombre: bg.cuadrado ? "OK - Cuadrado (Activo = Pasivo + Patrimonio)" : "DESCUADRADO -- REVISAR", monto: 0 },
  ];
  const hoja = crearHoja(filas, [
    { header: "Sección", ancho: 12, valor: (f) => f.seccion },
    { header: "Código", ancho: 12, valor: (f) => f.codigo },
    { header: "Cuenta", ancho: 44, valor: (f) => f.nombre },
    { header: "Monto", ancho: 16, valor: (f) => f.monto },
  ]);
  const libro = crearLibro([{ nombre: "Balance General", hoja }]);
  const etiquetaPeriodo = `${etiquetaColegio}_${bg.anio}-${String(bg.mesHasta).padStart(2, "0")}`;
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`Balance_General_${etiquetaPeriodo}`)}.xlsx` };
}

export function exportarLibroDiario(asientos: AsientoLibroDiario[], etiquetaPeriodo: string): { base64: string; nombreArchivo: string } {
  interface FilaPlano {
    clave: string;
    fecha: string;
    tipo: string;
    concepto: string;
    beneficiario: string;
    cuentaCodigo: string;
    cuentaNombre: string;
    debito: number;
    credito: number;
    estado: string;
  }
  const filas: FilaPlano[] = [];
  for (const a of asientos) {
    for (const l of a.lineas) {
      filas.push({
        clave: a.claveComprobante,
        fecha: a.fecha.toISOString().slice(0, 10),
        tipo: a.tipoComprobante,
        concepto: a.concepto ?? "",
        beneficiario: a.beneficiario ?? "",
        cuentaCodigo: l.cuentaCodigo,
        cuentaNombre: l.cuentaNombre,
        debito: l.debitoC,
        credito: l.creditoC,
        estado: a.estadoTexto,
      });
    }
  }
  const hoja = crearHoja(filas, [
    { header: "Comprobante", ancho: 14, valor: (f) => f.clave },
    { header: "Fecha", ancho: 12, valor: (f) => f.fecha },
    { header: "Tipo", ancho: 10, valor: (f) => f.tipo },
    { header: "Concepto", ancho: 42, valor: (f) => f.concepto },
    { header: "Beneficiario", ancho: 24, valor: (f) => f.beneficiario },
    { header: "Cuenta", ancho: 12, valor: (f) => f.cuentaCodigo },
    { header: "Nombre de Cuenta", ancho: 32, valor: (f) => f.cuentaNombre },
    { header: "Débito", ancho: 14, valor: (f) => f.debito },
    { header: "Crédito", ancho: 14, valor: (f) => f.credito },
    { header: "Estado", ancho: 18, valor: (f) => f.estado },
  ]);
  const libro = crearLibro([{ nombre: "Libro Diario", hoja }]);
  return { base64: libroABase64(libro), nombreArchivo: `${nombreDeArchivoSeguro(`Libro_Diario_${etiquetaPeriodo}`)}.xlsx` };
}

export function exportarLibroMayor(mayor: LibroMayorCuenta, etiquetaPeriodo: string): { base64: string; nombreArchivo: string } {
  const filas = mayor.movimientos.map((m) => ({
    fecha: m.fecha.toISOString().slice(0, 10),
    clave: m.claveComprobante,
    concepto: m.concepto ?? "",
    debito: m.debitoC,
    credito: m.creditoC,
    saldo: m.saldoAcumulado,
  }));
  const hoja = crearHoja(filas, [
    { header: "Fecha", ancho: 12, valor: (f) => f.fecha },
    { header: "Comprobante", ancho: 14, valor: (f) => f.clave },
    { header: "Concepto", ancho: 42, valor: (f) => f.concepto },
    { header: "Débito", ancho: 14, valor: (f) => f.debito },
    { header: "Crédito", ancho: 14, valor: (f) => f.credito },
    { header: "Saldo", ancho: 14, valor: (f) => f.saldo },
  ]);
  const hojaResumen = crearHoja(
    [
      { etiqueta: "Cuenta", valor: `${mayor.cuentaCodigo} - ${mayor.cuentaNombre}` },
      { etiqueta: "Periodo", valor: etiquetaPeriodo },
      { etiqueta: "Saldo Inicial", valor: mayor.saldoInicial },
      { etiqueta: "Total Débito", valor: mayor.totalDebito },
      { etiqueta: "Total Crédito", valor: mayor.totalCredito },
      { etiqueta: "Saldo Final", valor: mayor.saldoFinal },
    ],
    [
      { header: "Concepto", ancho: 20, valor: (r) => r.etiqueta },
      { header: "Valor", ancho: 26, valor: (r) => r.valor },
    ]
  );
  const libro = crearLibro([
    { nombre: "Resumen", hoja: hojaResumen },
    { nombre: "Movimientos", hoja },
  ]);
  return {
    base64: libroABase64(libro),
    nombreArchivo: `${nombreDeArchivoSeguro(`Libro_Mayor_${mayor.cuentaCodigo}_${etiquetaPeriodo}`)}.xlsx`,
  };
}
