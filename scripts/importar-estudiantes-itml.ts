/**
 * ============================================================================
 * Importación de estudiantes reales -- Instituto Tecnológico (ITML)
 * ============================================================================
 * Lee directamente la hoja "Base de Datos" de
 * `Ingresos 2026  ITML ACTUALIZADO 1.xlsx` (la que Eduardo subió al
 * proyecto) y carga los 152 alumnos de Secundaria Técnica a la tabla
 * `estudiantes`, con su ficha dinámica (Matrícula/Mensualidad) tal como
 * viene en el Excel -- que ya trae, por alumno, la tarifa que le
 * corresponde (base C$1,500, cupo ICCM C$800, Beca Total vía ICCM C$0, o un
 * pago diferenciado personalizado).
 *
 * Mismo patrón que `importar-estudiantes-el-mesias.ts`, con dos diferencias
 * de estructura de la hoja de origen (para que las tengas presentes):
 *   - Esta hoja NO trae columna de Cédula del Tutor (El Mesías sí) -- se
 *     importa como null; si más adelante la conseguís, se puede actualizar
 *     con un segundo import sin perder nada de lo ya cargado.
 *   - Todos los 152 alumnos son de "Secundaria Técnica" en 5 niveles (7mo a
 *     11mo. Grado) -- no hay filas de "Cursos Libres" ni "Carreras
 *     Técnicas" en esta hoja. Cuando subas los datos de esos programas te
 *     armamos otro importador igual de simple para esa fuente.
 *
 * Lo que el Excel real ya trae, tal cual, alumno por alumno (no se
 * recalcula nada, se copia la ficha dinámica exacta):
 *   - 107 alumnos:   Matrícula C$3,500 / Mensualidad C$1,500 (tarifa base).
 *   - 43 alumnos:    Programa "ICCM" / Mensualidad C$800 (tarifa de cupo).
 *   -  1 alumno  (ITML-2026-035, Carlos Antonio Barberena Hernandez):
 *                    Programa "ICCM" / Mensualidad C$0 -- su apadrinamiento
 *                    cubre el 100% de la mensualidad (Beca Total vía ICCM).
 *                    No se crea un registro de `EstudianteBeca` para este
 *                    caso porque la hoja no lo marca como una beca del
 *                    colegio sino como cobertura del programa ICCM (igual
 *                    que los ICCM de El Mesías con mensualidad en blanco);
 *                    avisame si preferís que sí quede como beca formal.
 *   -  1 alumno  (ITML-2026-125, Samantha Valeria Madrigal Martinez):
 *                    SIN Programa / Mensualidad C$1,000 -- pago diferenciado
 *                    personalizado (ni la tarifa base ni la de ICCM). Se
 *                    importa con ese monto exacto; si tenés una razón
 *                    documentada (beca parcial, acuerdo particular) decímela
 *                    y la dejamos anotada en `programa` u `observación`.
 *
 * Es idempotente: se puede correr de más sin duplicar nada (upsert por
 * código de estudiante).
 *
 * Uso:
 *   1) Poné "Ingresos 2026  ITML ACTUALIZADO 1.xlsx" (mismo nombre con que
 *      lo subiste al proyecto) en la carpeta "datos-historicos" en la raíz
 *      de este proyecto (o pasá otra ruta como argumento).
 *   2) npm run seed                    (si todavía no lo corriste)
 *   3) npm run seed:niveles-becas      (carga los niveles 7mo-11mo. Grado)
 *   4) npm run importar-estudiantes-itml [ruta-al-archivo]
 */
import path from "node:path";
import XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";

const ARCHIVO = process.argv[2] ?? path.join("./datos-historicos", "Ingresos 2026  ITML ACTUALIZADO 1.xlsx");
const COLEGIO_CODIGO = "ITML";
const ANIO_LECTIVO = 2026;
const FILA_ENCABEZADO = 6; // fila 7 en Excel (1-indexada) = índice 6 (0-indexado) -- igual estructura que El Mesías

function limpio(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

interface FilaEstudiante {
  codigo: string;
  nombre: string;
  nivelAcademico: string;
  modalidad: string;
  codigoMined: string | null;
  codigoInatec: string | null;
  nombreTutor: string | null;
  telefonoTutor: string | null;
  direccion: string | null;
  correo: string | null;
  programa: string | null;
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
    // Columnas (0-indexadas): 0 No. | 1 Código | 2 Nombre | 3 Nivel Académico
    // | 4 Modalidad | 5 Código MINED | 6 Código INATEC | 7 Nombre Tutor
    // | 8 Teléfono | 9 Dirección | 10 Correo | 11 Programa | 12 Matrícula
    // | 13 Mensualidad | 14 (Código del Estudiante, columna duplicada) | 15 (vacía)
    const codigo = limpio(f[1]);
    const nivelAcademico = limpio(f[3]);
    const montoMatriculaRaw = f[12];
    const montoMensualidadRaw = f[13];

    // Igual que en El Mesías: filas sin código, sin nivel o sin montos
    // numéricos no son alumnos activos con datos financieros reales -- se
    // omiten en vez de importarlas con ceros inventados.
    if (!codigo || !nivelAcademico || typeof montoMatriculaRaw !== "number" || typeof montoMensualidadRaw !== "number") {
      continue;
    }

    resultado.push({
      codigo,
      nombre: limpio(f[2]) ?? codigo,
      nivelAcademico,
      modalidad: limpio(f[4]) ?? "Secundaria Técnica",
      codigoMined: limpio(f[5]),
      codigoInatec: limpio(f[6]),
      nombreTutor: limpio(f[7]),
      telefonoTutor: limpio(f[8]) ?? (typeof f[8] === "number" ? String(f[8]) : null),
      direccion: limpio(f[9]),
      correo: limpio(f[10]),
      programa: limpio(f[11]),
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

  const filas = leerFilas(ARCHIVO);
  console.log(`Leídas ${filas.length} filas de estudiantes activos desde "${ARCHIVO}".`);

  const seccionCache = new Map<number, number>();
  let creados = 0;
  let actualizados = 0;
  let omitidosSinNivel = 0;
  let omitidosSinModalidad = 0;
  const anomalias: string[] = [];

  for (const f of filas) {
    const nivel = await prisma.nivelAcademico.findFirst({ where: { nombre: f.nivelAcademico } });
    if (!nivel) {
      console.warn(`  ⚠️  Nivel académico "${f.nivelAcademico}" no existe en el catálogo -- se omite ${f.codigo} (${f.nombre}).`);
      omitidosSinNivel++;
      continue;
    }

    const modalidad = await prisma.modalidad.findUnique({ where: { nombre: f.modalidad } });
    if (!modalidad) {
      console.warn(`  ⚠️  Modalidad "${f.modalidad}" no existe en el catálogo -- se omite ${f.codigo} (${f.nombre}).`);
      omitidosSinModalidad++;
      continue;
    }

    let seccionId = seccionCache.get(nivel.id);
    if (!seccionId) {
      const seccion = await obtenerOCrearSeccionUnica(colegio.id, nivel.id, anioLectivo.id);
      seccionId = seccion.id;
      seccionCache.set(nivel.id, seccionId);
    }

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
      cedulaTutor: null, // la hoja de ITML no trae esta columna (ver comentario del encabezado)
      telefonoTutor: f.telefonoTutor,
      direccion: f.direccion,
      correo: f.correo,
      programa: f.programa,
      montoMatriculaBase: f.montoMatricula,
      montoMensualidadBase: f.montoMensualidad,
    };

    const estudiante = existente
      ? await prisma.estudiante.update({ where: { id: existente.id }, data: datosEstudiante })
      : await prisma.estudiante.create({ data: datosEstudiante });

    if (existente) actualizados++;
    else creados++;

    // Señala los 2 casos fuera de patrón (tarifa base C$1,500 / cupo ICCM
    // C$800) para que quede visible en cada corrida, tal como se detectó al
    // analizar el Excel.
    if (f.programa === "ICCM" && f.montoMensualidad !== 800) {
      anomalias.push(`  • ${f.codigo} ${f.nombre}: ICCM con mensualidad C$${f.montoMensualidad} (no es la tarifa de cupo estándar C$800) -- Beca Total vía ICCM.`);
    } else if (f.programa !== "ICCM" && f.montoMensualidad !== 1500) {
      anomalias.push(`  • ${f.codigo} ${f.nombre}: mensualidad C$${f.montoMensualidad} sin ser ICCM (tarifa base es C$1,500) -- pago diferenciado personalizado.`);
    }
  }

  console.log(`✅ Estudiantes: ${creados} creados, ${actualizados} actualizados.`);
  if (omitidosSinNivel > 0) console.log(`⚠️  ${omitidosSinNivel} fila(s) con nivel académico no reconocido -- revisar arriba.`);
  if (omitidosSinModalidad > 0) console.log(`⚠️  ${omitidosSinModalidad} fila(s) con modalidad no reconocida -- revisar arriba.`);
  if (anomalias.length > 0) {
    console.log(`\n📌 Casos fuera del patrón estándar (${anomalias.length}) -- confirmame si están correctos:`);
    for (const a of anomalias) console.log(a);
  }
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
