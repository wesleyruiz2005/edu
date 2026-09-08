/**
 * ============================================================================
 * Importación de estudiantes reales -- Colegio El Mesías
 * ============================================================================
 * Lee directamente la hoja "Base de Datos" de
 * `Contabilidad_2026  El Mesias. Actual al 26.08.2026.xlsx` (la que subiste
 * al proyecto desde el inicio) y carga los estudiantes activos a la tabla
 * `estudiantes`, con su ficha dinámica (montos de matrícula/mensualidad) y
 * sus becas (Media Beca / Beca Interna) cuando la hoja las señala.
 *
 * Decisiones de importación (para que las revises):
 *   - La hoja tiene 300 códigos de estudiante, pero 50 de ellos NO tienen
 *     Nivel Académico ni montos (columnas en blanco) -- son anotaciones de
 *     alumnos retirados, graduados a secundaria, o incluso 2 filas que no
 *     son alumnos ("COLEGIO METODISTA LIBRE- EL BUEN PASTOR/EL MESIAS").
 *     Como no tienen datos financieros reales, este importador los SALTA
 *     por ahora -- si querés conservarlos como historial, decime y los
 *     agregamos aparte (inactivos, sin monto).
 *   - Otros 25 alumnos SÍ tienen Nivel y Matrícula, pero la Mensualidad
 *     viene en blanco -- 24 de esos 25 están marcados "ICCM" en Programa,
 *     así que no es un hueco de datos: ICCM cubre el 100% de su
 *     mensualidad y por eso el colegio no la factura (ese ingreso entra
 *     por el libro de ICCM). Se importan con `montoMensualidadBase = 0`.
 *     El único caso sin Matrícula NI Mensualidad (CMLM-2026-259) sí se
 *     omite, por no tener ningún dato financiero confiable.
 *   - La columna "Programa" del Excel mezcla dos cosas distintas: a veces
 *     dice "ICCM" (programa de apadrinamiento, se guarda tal cual en
 *     `estudiante.programa`), y a veces trae en realidad el tipo de BECA
 *     ("MEDIA", "MEDIA BECA", "Media beca", "INTERNA", "B. INTERNA",
 *     " INTERNA") -- esos 14 casos se convierten en un registro real de
 *     `EstudianteBeca` (Media Beca o Beca Interna) en vez de dejarlos como
 *     texto suelto en "programa".
 *   - La hoja no trae una columna separada de Papelería ni Décimo Tercer
 *     Mes -- se dejan en null (usan automáticamente el monto de Matrícula,
 *     por diseño de la ficha dinámica), tal como se documentó desde la
 *     Fase 2 de este proyecto.
 *   - Cada Nivel Académico tiene una sola sección "Única" para el año
 *     lectivo 2026 (la hoja de origen no distingue secciones A/B por
 *     grado) -- si en la realidad sí hay más de una sección por grado,
 *     avisame y lo ajustamos.
 *
 * Es idempotente: se puede correr de más sin duplicar nada (upsert por
 * código de estudiante; no crea una beca duplicada si ya existe una
 * vigente del mismo tipo).
 *
 * Uso:
 *   1) Poné "Contabilidad_2026  El Mesias. Actual al 26.08.2026.xlsx"
 *      (mismo nombre con que lo subiste al proyecto) en la carpeta
 *      "datos-historicos" en la raíz de este proyecto (o pasá otra ruta
 *      como argumento).
 *   2) npm run seed                    (si todavía no lo corriste)
 *   3) npm run seed:niveles-becas
 *   4) npm run importar-estudiantes-el-mesias [ruta-al-archivo]
 */
import path from "node:path";
import XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const ARCHIVO =
  process.argv[2] ?? path.join("./datos-historicos", "Contabilidad_2026  El Mesias. Actual al 26.08.2026.xlsx");
const COLEGIO_CODIGO = "CMLM";
const ANIO_LECTIVO = 2026;
const FILA_ENCABEZADO = 6; // fila 7 en Excel (1-indexada) = índice 6 (0-indexado)

function limpio(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

/** Detecta si el texto de la columna "Programa" en realidad es una beca disfrazada. */
function detectarBecaEnProgramaTexto(texto: string | null): "Media Beca" | "Beca Interna" | null {
  if (!texto) return null;
  const t = normalizar(texto);
  if (t === "MEDIA" || t === "MEDIA BECA") return "Media Beca";
  if (t === "INTERNA" || t === "B. INTERNA" || t === "B INTERNA") return "Beca Interna";
  return null;
}

interface FilaEstudiante {
  codigo: string;
  nombre: string;
  nivelAcademico: string;
  modalidad: string;
  codigoMined: string | null;
  codigoInatec: string | null;
  nombreTutor: string | null;
  cedulaTutor: string | null;
  telefonoTutor: string | null;
  direccion: string | null;
  correo: string | null;
  programaTexto: string | null;
  montoMatricula: number;
  montoMensualidad: number;
}

function leerFilas(archivo: string): FilaEstudiante[] {
  const wb = XLSX.readFile(archivo, { cellDates: true });
  const ws = wb.Sheets["Base de Datos"];
  if (!ws) throw new Error(`La hoja "Base de Datos" no existe en ${archivo}.`);
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: FILA_ENCABEZADO, defval: null });
  const datos = filas.slice(1); // descarta encabezado

  const resultado: FilaEstudiante[] = [];
  for (const f of datos) {
    const codigo = limpio(f[1]);
    const nivelAcademico = limpio(f[3]);
    const montoMatriculaRaw = f[13];
    let montoMensualidadRaw: number | null = typeof f[14] === "number" ? f[14] : null;
    const programaTexto = limpio(f[12]);

    // Se saltan las filas sin nivel académico ni matrícula: son anotaciones
    // de alumnos retirados/graduados a secundaria/no-alumnos, sin datos
    // financieros reales que importar (ver comentario del encabezado).
    if (!codigo || !nivelAcademico || typeof montoMatriculaRaw !== "number") {
      continue;
    }

    // 25 alumnos reales traen Matrícula pero Mensualidad en blanco, y TODOS
    // menos 1 están marcados "ICCM" en Programa -- no es un hueco de datos:
    // ICCM cubre el 100% de su mensualidad, así que el colegio no la
    // factura (ese ingreso entra por el libro de ICCM, no por este). Se
    // registra como 0 en vez de descartar al alumno.
    if (montoMensualidadRaw === null) {
      if (programaTexto === "ICCM") {
        montoMensualidadRaw = 0;
      } else {
        continue; // sin mensualidad y sin ser caso ICCM conocido -- no hay dato confiable, se omite
      }
    }

    resultado.push({
      codigo,
      nombre: limpio(f[2]) ?? codigo,
      nivelAcademico,
      modalidad: limpio(f[4]) ?? "Educación Preescolar y Primaria",
      codigoMined: limpio(f[5]),
      codigoInatec: limpio(f[6]),
      nombreTutor: limpio(f[7]),
      cedulaTutor: limpio(f[8]),
      telefonoTutor: limpio(f[9]),
      direccion: limpio(f[10]),
      correo: limpio(f[11]),
      programaTexto,
      montoMatricula: montoMatriculaRaw,
      montoMensualidad: montoMensualidadRaw,
    });
  }
  return resultado;
}

async function obtenerOCrearSeccionUnica(colegioId: number, nivelAcademicoId: number, anioLectivoId: number) {
  const existente = await prisma.seccion.findFirst({
    where: { colegioId, nivelAcademicoId, anioLectivoId, nombreSeccion: "Única" },
  });
  if (existente) return existente;
  return prisma.seccion.create({
    data: { colegioId, nivelAcademicoId, anioLectivoId, nombreSeccion: "Única" },
  });
}

async function main() {
  const colegio = await prisma.colegio.findUniqueOrThrow({ where: { codigo: COLEGIO_CODIGO } });
  const anioLectivo = await prisma.anioLectivo.upsert({
    where: { anio: ANIO_LECTIVO },
    create: { anio: ANIO_LECTIVO },
    update: {},
  });

  const tipoMediaBeca = await prisma.tipoBeca.findFirst({ where: { nombre: "Media Beca" } });
  const tipoBecaInterna = await prisma.tipoBeca.findFirst({ where: { nombre: "Beca Interna" } });
  if (!tipoMediaBeca || !tipoBecaInterna) {
    throw new Error('Faltan los tipos de beca "Media Beca"/"Beca Interna". Corré "npm run seed:niveles-becas" primero.');
  }

  const filas = leerFilas(ARCHIVO);
  console.log(`Leídas ${filas.length} filas de estudiantes activos desde "${ARCHIVO}".`);

  const seccionCache = new Map<string, number>();
  let creados = 0;
  let actualizados = 0;
  let becasCreadas = 0;
  let omitidosSinNivel = 0;

  for (const f of filas) {
    const nivel = await prisma.nivelAcademico.findFirst({ where: { nombre: f.nivelAcademico } });
    if (!nivel) {
      console.warn(`  ⚠️  Nivel académico "${f.nivelAcademico}" no existe en el catálogo -- se omite ${f.codigo} (${f.nombre}).`);
      omitidosSinNivel++;
      continue;
    }

    const modalidad = await prisma.modalidad.findUnique({ where: { nombre: f.modalidad } });
    if (!modalidad) {
      throw new Error(`No existe la modalidad "${f.modalidad}" (estudiante ${f.codigo}).`);
    }

    const claveSeccion = `${nivel.id}`;
    let seccionId = seccionCache.get(claveSeccion);
    if (!seccionId) {
      const seccion = await obtenerOCrearSeccionUnica(colegio.id, nivel.id, anioLectivo.id);
      seccionId = seccion.id;
      seccionCache.set(claveSeccion, seccionId);
    }

    const becaDetectada = detectarBecaEnProgramaTexto(f.programaTexto);
    // "programa" solo guarda ICCM (o cualquier otro valor real de programa);
    // si en realidad era una beca disfrazada, no se propaga como texto.
    const programaFinal = becaDetectada ? null : f.programaTexto;

    const existente = await prisma.estudiante.findUnique({
      where: { colegioId_codigoEstudiantil: { colegioId: colegio.id, codigoEstudiantil: f.codigo } },
    });

    const datosEstudiante = {
      colegioId: colegio.id,
      codigoEstudiantil: f.codigo,
      nombreCompleto: f.nombre,
      nivelAcademicoId: nivel.id,
      seccionId,
      modalidadId: modalidad.id,
      codigoMined: f.codigoMined,
      codigoInatec: f.codigoInatec,
      nombreTutor: f.nombreTutor ?? "(sin tutor registrado)",
      cedulaTutor: f.cedulaTutor,
      telefonoTutor: f.telefonoTutor,
      direccion: f.direccion,
      correo: f.correo,
      programa: programaFinal,
      montoMatriculaBase: f.montoMatricula,
      montoMensualidadBase: f.montoMensualidad,
    };

    const estudiante = existente
      ? await prisma.estudiante.update({ where: { id: existente.id }, data: datosEstudiante })
      : await prisma.estudiante.create({ data: datosEstudiante });

    if (existente) actualizados++;
    else creados++;

    if (becaDetectada) {
      const tipoBecaId = becaDetectada === "Media Beca" ? tipoMediaBeca.id : tipoBecaInterna.id;
      const becaVigente = await prisma.estudianteBeca.findFirst({
        where: { estudianteId: estudiante.id, tipoBecaId, fechaFin: null },
      });
      if (!becaVigente) {
        await prisma.estudianteBeca.create({
          data: {
            estudianteId: estudiante.id,
            tipoBecaId,
            fechaInicio: new Date(Date.UTC(ANIO_LECTIVO, 0, 1)),
            observacion: `Detectada automáticamente desde la columna "Programa" del Excel original ("${f.programaTexto}").`,
          },
        });
        becasCreadas++;
      }
    }
  }

  console.log(`✅ Estudiantes: ${creados} creados, ${actualizados} actualizados.`);
  console.log(`✅ Becas nuevas registradas: ${becasCreadas}.`);
  if (omitidosSinNivel > 0) console.log(`⚠️  ${omitidosSinNivel} fila(s) con nivel académico no reconocido -- revisar arriba.`);
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
