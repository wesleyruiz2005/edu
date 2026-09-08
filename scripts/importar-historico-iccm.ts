/**
 * ============================================================================
 * Importación del histórico ICCM (2022-2025)
 * ============================================================================
 * Lee directamente los Excel originales que subiste a la carpeta del
 * proyecto y carga:
 *
 *   1. La Jornalización de `Sistema_Contable_ICCM_<año>.xlsm` (2022-2025) →
 *      Comprobante + AsientoContable del libro ICCM. Es el libro diario
 *      formal, así que se importa TAL CUAL, comprobante por comprobante
 *      (agrupando las líneas por "N° Asiento"), sin recalcular nada.
 *   2. Las asignaciones mensuales por niño ("Patrocinados (S)" + "Retenidos"
 *      cruzados), los regalos ("Regalos (Gifts)") y la conciliación bancaria
 *      mensual ("Conciliacion bancaria") de `Apadrinamientos_Consolidado_
 *      <año>.xlsx` (2023-2025 -- el de 2022 no trae datos reales, ver
 *      `claude/analisis-historico-iccm-2022-2025.md`).
 *
 * IMPORTANTE -- decisiones de diseño que Eduardo ya confirmó (7 sept 2026):
 *   - 2022: SÍ se importa la Jornalización (87 asientos, cuadra en USD).
 *     `Apadrinamientos_Consolidado_2022.xlsx` no tiene nada que importar.
 *   - La nota "OJO LA SUMA NO CUADRA-REVISAR" que trae el propio Excel en
 *     2022/2023 es una falsa alarma de la fórmula de verificación del
 *     archivo (compara el total en córdobas contra el total en dólares, así
 *     que nunca coincidirían) -- el cuadre real (débito USD = crédito USD)
 *     SÍ se valida acá, línea por línea, antes de guardar cada comprobante.
 *   - Junio 2025 en $0 en "Conciliacion bancaria": confirmado como real (no
 *     se recibió dinero ese mes; en julio entraron dos pagos) -- se importa
 *     tal cual, sin tratarlo como un hueco de datos.
 *   - La caída a $0 de la comisión internacional desde julio 2025: también
 *     confirmada como real (el banco dejó de cobrarla; puede volver a
 *     cobrarla en el futuro) -- se importa tal cual.
 *   - El estado "Sin dato" de "Retenido este mes" (aparece desde 2024): se
 *     deja EXACTAMENTE así (no se fuerza a retenido ni a no-retenido) --
 *     ver el enum `EstadoRetencionIccm`. Eduardo lo va a verificar después.
 *
 * Este script NO enlaza las asignaciones/regalos/conciliaciones por niño a
 * un comprobante específico de la Jornalización -- son dos capas distintas
 * del mismo dinero (el libro diario formal vs. el detalle de auditoría por
 * niño) y adivinar esa correspondencia línea por línea sería más riesgoso
 * que dejarlas separadas. `comprobanteId` queda en null en esos registros.
 *
 * Es IDEMPOTENTE: se puede correr de más sin duplicar nada (usa upsert en
 * las asignaciones/conciliaciones, y se salta cualquier comprobante de
 * Jornalización cuya clave ya exista).
 *
 * Uso:
 *   1) Poné los 8 archivos originales (mismos nombres con que los subiste
 *      al proyecto) dentro de una carpeta `datos-historicos/` en la raíz de
 *      este proyecto (o pasá otra ruta como argumento).
 *   2) npm run seed:iccm-ninos   (si todavía no lo corriste)
 *   3) npm run importar-historico-iccm [ruta-a-la-carpeta]
 */
import path from "node:path";
import XLSX from "xlsx";
import { prisma } from "../src/lib/prisma";
import { siguienteNumeroComprobante, obtenerCuenta } from "../src/lib/caja/comprobante-utils";
import type { EstadoRetencionIccm, TipoRegaloIccm, EstadoConciliacionIccm } from "@prisma/client";

const CARPETA = process.argv[2] ?? "./datos-historicos";
const ANIOS_JORNALIZACION = [2022, 2023, 2024, 2025];
const ANIOS_APADRINAMIENTOS = [2023, 2024, 2025]; // 2022 no trae datos reales -- ver nota arriba

const COLEGIO_POR_TEXTO: Record<string, string> = {
  "Colegio El Mesias": "CMLM",
  "Colegio El Buen Pastor": "CBP",
  "Instituto Tecnologico": "ITML",
};
const COLEGIO_POR_PREFIJO: Record<string, string> = { NC100: "CMLM", NC200: "CBP", NC300: "ITML" };

const MESES_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function parsearMesTexto(texto: string): { anio: number; mes: number } {
  const m = String(texto).trim().toLowerCase().match(/^([a-zñáéíóú]+)\s+(\d{4})$/i);
  if (!m) throw new Error(`No pude interpretar "${texto}" como "<mes> <año>".`);
  const idx = MESES_ES.findIndex((n) => n === sinAcentos(m[1]));
  if (idx === -1) throw new Error(`Mes no reconocido dentro de "${texto}".`);
  return { mes: idx + 1, anio: Number(m[2]) };
}

function decANumero(d: unknown): number {
  if (d && typeof d === "object" && "toNumber" in d) return (d as { toNumber(): number }).toNumber();
  return Number(d ?? 0);
}

function esCodigoNc(v: unknown): v is string {
  return typeof v === "string" && /^NC\d{3}-\d+/.test(v);
}

/** Busca el niño por su código NC; si el histórico trae un código que ya no está en el maestro 2026 (baja anterior a 2026), lo crea mínimamente. */
async function resolverNino(codigoNc: string, nombre: unknown, colegioTexto: unknown) {
  const existente = await prisma.iccmNino.findUnique({ where: { codigoNc } });
  if (existente) return existente;

  const prefijo = codigoNc.slice(0, 5);
  const colegioCodigo =
    (typeof colegioTexto === "string" && COLEGIO_POR_TEXTO[colegioTexto]) || COLEGIO_POR_PREFIJO[prefijo];
  if (!colegioCodigo) {
    throw new Error(`No pude determinar el colegio del niño histórico "${codigoNc}" (colegio reportado: "${colegioTexto}").`);
  }
  const colegio = await prisma.colegio.findUniqueOrThrow({ where: { codigo: colegioCodigo } });
  const nuevo = await prisma.iccmNino.create({
    data: {
      codigoNc,
      colegioId: colegio.id,
      nombreCompleto: typeof nombre === "string" && nombre.trim() ? nombre.trim() : `(histórico) ${codigoNc}`,
      cuotaMensualUsd: 0,
      estado: "DE_BAJA",
    },
  });
  console.warn(`  ⚠️  Niño ${codigoNc} no estaba en el maestro 2026 -- se creó como histórico (estado DE_BAJA).`);
  return nuevo;
}

async function obtenerOCrearAnioLectivo(anio: number) {
  return prisma.anioLectivo.upsert({ where: { anio }, create: { anio }, update: {} });
}

function leerHoja(archivo: string, hoja: string, filaEncabezado: number): unknown[][] {
  const wb = XLSX.readFile(archivo, { cellDates: true });
  const ws = wb.Sheets[hoja];
  if (!ws) throw new Error(`La hoja "${hoja}" no existe en ${archivo}.`);
  const filas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: filaEncabezado, defval: null });
  return filas.slice(1); // descarta la fila de encabezado
}

/** Busca en qué fila (0-indexada) está el encabezado real, comparando la primera columna -- necesario porque 2025 movió "Conciliacion bancaria" a la fila 5 en vez de la fila 1. */
function detectarFilaEncabezado(archivo: string, hoja: string, primeraColumnaEsperada: string, maxFilas = 10): number {
  const wb = XLSX.readFile(archivo, { cellDates: true });
  const ws = wb.Sheets[hoja];
  if (!ws) throw new Error(`La hoja "${hoja}" no existe en ${archivo}.`);
  for (let r = 0; r < maxFilas; r++) {
    const fila = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: r, defval: null })[0];
    if (fila?.[0] === primeraColumnaEsperada) return r;
  }
  throw new Error(`No encontré la fila de encabezado ("${primeraColumnaEsperada}") en las primeras ${maxFilas} filas de "${hoja}".`);
}

// ============================================================================
// 1. Jornalización -- Comprobante + AsientoContable (libro ICCM)
// ============================================================================

interface LineaJornal {
  numeroLinea: number;
  nAsiento: string;
  fecha: Date;
  proveedor: string | null;
  concepto: string | null;
  codigoCuenta: string;
  tasaCambio: number;
  monto: number;
  movimiento: "Débito" | "Crédito";
  debitoNio: number;
  creditoNio: number;
  mesCol: number;
}

function mapearFilaJornal(f: unknown[]): LineaJornal | null {
  if (f[0] == null || f[1] == null) return null; // fila vacía / de relleno
  const fecha = f[2] instanceof Date ? f[2] : new Date(String(f[2]));
  return {
    numeroLinea: Number(f[0]),
    nAsiento: String(f[1]),
    fecha,
    proveedor: (f[3] as string) ?? null,
    concepto: (f[4] as string) ?? null,
    codigoCuenta: String(f[6]),
    tasaCambio: typeof f[7] === "number" ? f[7] : 1,
    monto: Number(f[9]),
    movimiento: f[10] === "Crédito" ? "Crédito" : "Débito",
    debitoNio: Number(f[11] ?? 0),
    creditoNio: Number(f[12] ?? 0),
    mesCol: Number(f[16]),
  };
}

async function importarJornalizacionAnio(anio: number, colegioAnclaId: number) {
  const archivo = path.join(CARPETA, `Sistema_Contable_ICCM_${anio}.xlsm`);
  const filas = leerHoja(archivo, "Jornalización", 5)
    .map(mapearFilaJornal)
    .filter((f): f is LineaJornal => f !== null);

  const grupos = new Map<string, LineaJornal[]>();
  for (const f of filas) {
    const lista = grupos.get(f.nAsiento) ?? [];
    lista.push(f);
    grupos.set(f.nAsiento, lista);
  }

  const anioLectivo = await obtenerOCrearAnioLectivo(anio);
  const gruposOrdenados = [...grupos.entries()].sort(
    (a, b) => a[1][0].fecha.getTime() - b[1][0].fecha.getTime()
  );

  let creados = 0;
  let omitidos = 0;

  for (const [nAsiento, lineas] of gruposOrdenados) {
    const claveComprobante = `HIST-${anio}-${nAsiento}`;

    const yaExiste = await prisma.comprobante.findUnique({
      where: { colegioId_libro_claveComprobante: { colegioId: colegioAnclaId, libro: "ICCM", claveComprobante } },
    });
    if (yaExiste) {
      omitidos++;
      continue;
    }

    const totalDebito = lineas.filter((l) => l.movimiento === "Débito").reduce((s, l) => s + l.monto, 0);
    const totalCredito = lineas.filter((l) => l.movimiento === "Crédito").reduce((s, l) => s + l.monto, 0);
    if (Math.abs(totalDebito - totalCredito) > 0.01) {
      console.warn(
        `  ⚠️  Asiento ${claveComprobante} NO cuadra en USD (débito ${totalDebito.toFixed(2)} vs crédito ${totalCredito.toFixed(2)}) -- se omite, revisar a mano en el Excel original.`
      );
      omitidos++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const numeroComprobante = await siguienteNumeroComprobante(tx, {
        colegioId: colegioAnclaId,
        libro: "ICCM",
        tipoComprobante: "CD",
      });
      const primera = lineas[0];
      const proveedores = [...new Set(lineas.map((l) => l.proveedor).filter(Boolean))];
      const conceptos = [...new Set(lineas.map((l) => l.concepto).filter(Boolean))];
      const concepto = [proveedores.join(" / "), conceptos.join(" | ")].filter(Boolean).join(" -- ") || null;

      const comprobante = await tx.comprobante.create({
        data: {
          colegioId: colegioAnclaId,
          libro: "ICCM",
          tipoComprobante: "CD",
          numeroComprobante,
          claveComprobante,
          fecha: primera.fecha,
          concepto,
          anioLectivoId: anioLectivo.id,
          mes: primera.mesCol || primera.fecha.getUTCMonth() + 1,
          origen: "IMPORTACION_HISTORICA",
          estado: "CUADRADO",
        },
      });

      for (const l of lineas) {
        const cuenta = await obtenerCuenta(tx, "ICCM", l.codigoCuenta);
        await tx.asientoContable.create({
          data: {
            comprobanteId: comprobante.id,
            numeroLinea: l.numeroLinea,
            cuentaId: cuenta.id,
            movimiento: l.movimiento === "Débito" ? "DEBITO" : "CREDITO",
            moneda: "USD",
            tasaCambio: l.tasaCambio || 1,
            montoMonedaOrigen: l.monto,
            debitoC: l.debitoNio,
            creditoC: l.creditoNio,
          },
        });
      }
    });
    creados++;
  }

  console.log(`  ${anio}: ${creados} comprobantes creados, ${omitidos} omitidos (ya existían o no cuadraban).`);
}

// ============================================================================
// 2. Patrocinados (S) + Retenidos -> IccmAsignacionMensual
// ============================================================================

async function importarPatrocinadosYRetenidos(anio: number) {
  const archivo = path.join(CARPETA, `Apadrinamientos_Consolidado_${anio}.xlsx`);
  const patrocinados = leerHoja(archivo, "Patrocinados (S)", 0);
  const retenidos = leerHoja(archivo, "Retenidos", 0);

  const motivoPorClave = new Map<string, string | null>();
  for (const r of retenidos) {
    const claveMes = r[0];
    const codigo = r[2];
    if (claveMes == null || codigo == null) continue;
    const motivo = (r[7] as string) ?? (r[6] as string) ?? null;
    motivoPorClave.set(`${claveMes}|${codigo}`, motivo);
  }

  let procesados = 0;
  for (const p of patrocinados) {
    const claveMes = p[0];
    const codigo = p[2];
    const colegioTexto = p[3];
    const nombre = p[4];
    const retenidoTexto = p[7];
    const montoRecibido = p[8];
    if (claveMes == null || codigo == null) continue;

    const [anioStr, mesStr] = String(claveMes).split("-");
    const anioReal = Number(anioStr);
    const mesReal = Number(mesStr);

    const nino = await resolverNino(String(codigo), nombre, colegioTexto);

    const estadoRetencion: EstadoRetencionIccm =
      retenidoTexto === "Si" ? "RETENIDO" : retenidoTexto === "No" ? "NO_RETENIDO" : "SIN_DATO";

    const montoAsignado =
      typeof montoRecibido === "number" ? Math.round((montoRecibido + Number.EPSILON) * 100) / 100 : 0;
    // El histórico no trae una "cuota base" separada por mes -- se usa el
    // monto realmente recibido cuando lo hay, y si no, la cuota actual del
    // niño como mejor aproximación disponible (no afecta el ingreso ya
    // registrado, es solo un dato de referencia).
    const montoBase = montoAsignado > 0 ? montoAsignado : decANumero(nino.cuotaMensualUsd);

    await prisma.iccmAsignacionMensual.upsert({
      where: { ninoId_anio_mes: { ninoId: nino.id, anio: anioReal, mes: mesReal } },
      create: {
        ninoId: nino.id,
        anio: anioReal,
        mes: mesReal,
        montoBase,
        estadoRetencion,
        motivoRetencion: motivoPorClave.get(`${claveMes}|${codigo}`) ?? null,
        montoAsignado,
      },
      update: {
        montoBase,
        estadoRetencion,
        motivoRetencion: motivoPorClave.get(`${claveMes}|${codigo}`) ?? null,
        montoAsignado,
      },
    });
    procesados++;
  }

  console.log(`  ${anio}: ${procesados} asignaciones mensuales importadas (Patrocinados (S) + Retenidos).`);
}

// ============================================================================
// 3. Regalos (Gifts) -> IccmRegalo
// ============================================================================

async function importarRegalos(anio: number) {
  const archivo = path.join(CARPETA, `Apadrinamientos_Consolidado_${anio}.xlsx`);
  const filas = leerHoja(archivo, "Regalos (Gifts)", 0);

  let creados = 0;
  let omitidos = 0;

  for (const f of filas) {
    const claveMes = f[0];
    const tipoTexto = f[2];
    const fechaRaw = f[3];
    const codigoRaw = f[4];
    const nota = f[6];
    const monto = f[7];

    if (claveMes == null || String(claveMes).toLowerCase().includes("total") || typeof monto !== "number") {
      omitidos++; // fila de totales, o fila sin monto real
      continue;
    }

    const fecha = fechaRaw instanceof Date ? fechaRaw : new Date(String(fechaRaw));
    if (isNaN(fecha.getTime())) {
      omitidos++;
      continue;
    }

    const codigo = esCodigoNc(codigoRaw) ? codigoRaw : null; // descarta fechas metidas por error en la columna Código (visto en 2025)
    const tipo: TipoRegaloIccm =
      typeof tipoTexto === "string" && tipoTexto.toLowerCase().includes("non") ? "NON_CHILD_GIFT" : "CHILD_GIFT";

    const ninoId = codigo ? (await resolverNino(codigo, null, null)).id : null;

    const yaExiste = await prisma.iccmRegalo.findFirst({ where: { ninoId, fecha, monto, tipo } });
    if (yaExiste) {
      omitidos++;
      continue;
    }

    await prisma.iccmRegalo.create({
      data: { ninoId, colegioId: null, tipo, fecha, monto, nota: typeof nota === "string" ? nota : null },
    });
    creados++;
  }

  console.log(`  ${anio}: ${creados} regalos importados, ${omitidos} filas omitidas (totales/sin monto/duplicadas).`);
}

// ============================================================================
// 4. Conciliacion bancaria -> IccmConciliacionMensual
// ============================================================================

async function importarConciliacionBancaria(anio: number) {
  const archivo = path.join(CARPETA, `Apadrinamientos_Consolidado_${anio}.xlsx`);
  const filaEncabezado = detectarFilaEncabezado(archivo, "Conciliacion bancaria", "Mes de asignación");
  const filas = leerHoja(archivo, "Conciliacion bancaria", filaEncabezado);

  let procesados = 0;
  for (const f of filas) {
    const mesTexto = f[0];
    if (mesTexto == null || String(mesTexto).toLowerCase().includes("total")) continue;

    const { anio: anioReal, mes } = parsearMesTexto(String(mesTexto));
    const totalReportado = Number(f[5] ?? 0);
    const comisionInternacional = Number(f[6] ?? 0);
    const totalEsperado = Number(f[7] ?? 0);
    const recibidoBanco = f[8] != null ? Number(f[8]) : null;
    const mesRecepcion = f[9] != null ? String(f[9]) : null;
    const estadoTexto = f[11];
    const comisionBacNacional = Number(f[12] ?? 0);

    const estado: EstadoConciliacionIccm = estadoTexto === "CUADRA" ? "CUADRA" : estadoTexto ? "REVISAR" : "SIN_DATO";

    await prisma.iccmConciliacionMensual.upsert({
      where: { anio_mes: { anio: anioReal, mes } },
      create: {
        anio: anioReal,
        mes,
        totalReportadoFmc: totalReportado,
        comisionBancariaInternacional: comisionInternacional,
        totalEsperadoAcreditado: totalEsperado,
        totalRecibidoBanco: recibidoBanco,
        mesRecepcionBanco: mesRecepcion,
        estado,
        comisionBacNacional,
      },
      update: {
        totalReportadoFmc: totalReportado,
        comisionBancariaInternacional: comisionInternacional,
        totalEsperadoAcreditado: totalEsperado,
        totalRecibidoBanco: recibidoBanco,
        mesRecepcionBanco: mesRecepcion,
        estado,
        comisionBacNacional,
      },
    });
    procesados++;
  }

  console.log(`  ${anio}: ${procesados} meses de conciliación bancaria importados.`);
}

// ============================================================================

async function main() {
  const colegioAncla = await prisma.colegio.findFirstOrThrow({ orderBy: { id: "asc" } });

  console.log(`Leyendo archivos desde: ${path.resolve(CARPETA)}`);

  console.log("\n== 1. Jornalización histórica (libro ICCM) ==");
  for (const anio of ANIOS_JORNALIZACION) {
    await importarJornalizacionAnio(anio, colegioAncla.id);
  }

  console.log("\n== 2. Asignaciones mensuales por niño (Patrocinados + Retenidos) ==");
  for (const anio of ANIOS_APADRINAMIENTOS) {
    await importarPatrocinadosYRetenidos(anio);
  }

  console.log("\n== 3. Regalos (Gifts) ==");
  for (const anio of ANIOS_APADRINAMIENTOS) {
    await importarRegalos(anio);
  }

  console.log("\n== 4. Conciliación bancaria mensual ==");
  for (const anio of ANIOS_APADRINAMIENTOS) {
    await importarConciliacionBancaria(anio);
  }

  console.log("\n✅ Importación histórica completa.");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
