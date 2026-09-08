/**
 * ============================================================================
 * UTILIDAD COMPARTIDA DE EXPORTACIÓN A EXCEL (.xlsx)
 * ============================================================================
 * Requisito transversal de Eduardo (7 sept 2026, de noche): "TODO tipo de
 * reporte, nómina y estado financiero cuente con una función nativa de
 * descarga y exportación directa a archivos EXCEL (.xlsx)".
 *
 * En vez de que cada módulo arme su propio Excel a mano, todos usan estas
 * mismas funciones (sobre el paquete `xlsx`, ya en package.json): se define
 * la lista de columnas (encabezado + de dónde sale el valor) UNA vez por
 * reporte, y el resto (ancho de columnas, armar la hoja, unir varias hojas
 * en un libro, convertirlo a Base64 para poder bajarlo desde el navegador)
 * es automático.
 *
 * Nota sobre estilos: la versión libre de `xlsx` (SheetJS Community) NO
 * soporta negrita/colores de celda -- solo valores y ancho de columna. Si
 * Eduardo quiere encabezados en negrita/con color más adelante, hay que
 * migrar a `exceljs` (paquete distinto, con licencia también libre) -- se
 * deja anotado acá para no prometer algo que esta versión no hace.
 */
import * as XLSX from "xlsx";

export interface ColumnaExcel<T> {
  header: string;
  /** Ancho aproximado en caracteres (equivalente a "wch" de xlsx). */
  ancho?: number;
  valor: (fila: T) => string | number | boolean | null | undefined;
}

/** Arma UNA hoja de cálculo a partir de una lista de filas + definición de columnas. */
export function crearHoja<T>(filas: T[], columnas: ColumnaExcel<T>[]): XLSX.WorkSheet {
  const encabezados = columnas.map((c) => c.header);
  const datos = filas.map((fila) => columnas.map((c) => c.valor(fila) ?? ""));
  const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...datos]);
  hoja["!cols"] = columnas.map((c) => ({ wch: c.ancho ?? 18 }));
  return hoja;
}

export interface HojaLibro {
  /** Nombre de la pestaña -- Excel limita a 31 caracteres y prohíbe : \ / ? * [ ]. */
  nombre: string;
  hoja: XLSX.WorkSheet;
}

/** Une varias hojas en UN libro (.xlsx), sanitizando el nombre de cada pestaña. */
export function crearLibro(hojas: HojaLibro[]): XLSX.WorkBook {
  const libro = XLSX.utils.book_new();
  for (const h of hojas) {
    const nombreSeguro = h.nombre.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || "Hoja";
    XLSX.utils.book_append_sheet(libro, h.hoja, nombreSeguro);
  }
  return libro;
}

/** Convierte el libro a Base64 -- así una Server Action puede devolverlo tal cual al navegador (los Server Actions no pueden devolver Buffer/Blob nativos). */
export function libroABase64(libro: XLSX.WorkBook): string {
  return XLSX.write(libro, { type: "base64", bookType: "xlsx" });
}

/** Forma estándar que devuelve CUALQUIER Server Action de exportación -- es lo que espera `<BotonDescargarExcel>` en el cliente. */
export interface ResultadoDescargaExcel {
  ok: boolean;
  mensaje?: string;
  base64?: string;
  nombreArchivo?: string;
}

/** Sanitiza un texto para usarlo como parte del NOMBRE DE ARCHIVO (no de la pestaña) -- quita espacios, /, acentos raros de encoding, etc. */
export function nombreDeArchivoSeguro(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
