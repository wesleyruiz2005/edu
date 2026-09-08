import type { PrismaClient, ConceptoArancel } from "@prisma/client";
import { calcularMontoFacturado, calcularFechaVencimiento, becaAplicaAConcepto } from "./reglas";
import { construirMapaDeConceptosPorModalidad } from "./mapa-conceptos";
import { obtenerReglaMoraVigente } from "./regla-mora-vigente";
import { obtenerModalidadVigente } from "./historial-modalidad";

export interface ResumenGeneracion {
  creados: number;
  actualizados: number;
  sinCambios: number;
  omitidosTienenPagos: number;
  advertencias: string[];
}

function resumenVacio(): ResumenGeneracion {
  return { creados: 0, actualizados: 0, sinCambios: 0, omitidosTienenPagos: 0, advertencias: [] };
}

type Resultado = "creado" | "actualizado" | "sin_cambios" | "omitido_tiene_pagos";

function contabilizar(resumen: ResumenGeneracion, resultado: Resultado) {
  if (resultado === "creado") resumen.creados++;
  else if (resultado === "actualizado") resumen.actualizados++;
  else if (resultado === "sin_cambios") resumen.sinCambios++;
  else resumen.omitidosTienenPagos++;
}

/**
 * Busca, entre las becas VIGENTES de un estudiante (fecha_inicio <= fecha
 * <= fecha_fin, o fecha_fin nula = sigue activa), la que corresponde a un
 * concepto específico. Si por error administrativo hay más de una que
 * aplicaría al mismo concepto, se usa la más reciente y se deja constancia
 * en advertencias (eso NO debería pasar en el día a día, pero el sistema
 * no se cae por eso).
 */
interface BecaResuelta {
  estudianteBecaId: number;
  valorAplicado: { tipoCalculo: "PORCENTAJE" | "MONTO_FIJO"; valor: number; aplicaAConceptoId: number | null };
}

async function resolverBecaVigente(
  prisma: PrismaClient,
  estudianteId: number,
  concepto: Pick<ConceptoArancel, "id" | "esRecurrenteMensual">,
  fecha: Date,
  advertencias: string[]
): Promise<BecaResuelta | null> {
  const becasActivas = await prisma.estudianteBeca.findMany({
    where: {
      estudianteId,
      fechaInicio: { lte: fecha },
      OR: [{ fechaFin: null }, { fechaFin: { gte: fecha } }],
    },
    include: { tipoBeca: true },
    orderBy: { fechaInicio: "desc" },
  });

  const aplicables = becasActivas.filter((b) =>
    becaAplicaAConcepto(
      {
        tipoCalculo: b.tipoBeca.tipoCalculo,
        valor: b.tipoBeca.valor.toNumber(),
        aplicaAConceptoId: b.tipoBeca.aplicaAConceptoId,
      },
      concepto
    )
  );

  if (aplicables.length === 0) return null;

  if (aplicables.length > 1) {
    advertencias.push(
      `El estudiante #${estudianteId} tiene ${aplicables.length} becas activas que aplicarían al mismo concepto (#${concepto.id}); se usó la más reciente (beca #${aplicables[0].id}). Revisa si alguna ya debería tener fecha de fin.`
    );
  }

  const elegida = aplicables[0];
  return {
    estudianteBecaId: elegida.id,
    valorAplicado: {
      tipoCalculo: elegida.tipoBeca.tipoCalculo,
      valor: elegida.tipoBeca.valor.toNumber(),
      aplicaAConceptoId: elegida.tipoBeca.aplicaAConceptoId,
    },
  };
}

export interface ParametrosCargo {
  estudianteId: number;
  concepto: ConceptoArancel;
  anioLectivoId: number;
  mes: number | null;
  montoBase: number;
  fechaVencimiento: Date;
  fechaEvaluacion: Date;
  advertencias: string[];
}

/**
 * Crea el cargo si no existe, o lo ajusta si ya existía pero AÚN no le han
 * abonado nada (para no descuadrar un cobro que el cajero ya hizo). Es
 * seguro llamar esta función muchas veces con los mismos datos -- nunca
 * duplica un cargo, gracias a la llave única (estudiante, concepto, año
 * lectivo, mes) de `cargos_estudiante`.
 */
export async function crearOActualizarCargo(prisma: PrismaClient, p: ParametrosCargo): Promise<Resultado> {
  const becaResuelta = await resolverBecaVigente(
    prisma,
    p.estudianteId,
    p.concepto,
    p.fechaEvaluacion,
    p.advertencias
  );
  const montoFacturado = calcularMontoFacturado(p.montoBase, p.concepto, becaResuelta?.valorAplicado ?? null);

  const existente = await prisma.cargoEstudiante.findUnique({
    where: {
      estudianteId_conceptoId_anioLectivoId_mes: {
        estudianteId: p.estudianteId,
        conceptoId: p.concepto.id,
        anioLectivoId: p.anioLectivoId,
        mes: p.mes,
      },
    },
  });

  if (!existente) {
    await prisma.cargoEstudiante.create({
      data: {
        estudianteId: p.estudianteId,
        conceptoId: p.concepto.id,
        anioLectivoId: p.anioLectivoId,
        mes: p.mes,
        montoOriginal: p.montoBase,
        becaAplicadaId: becaResuelta?.estudianteBecaId ?? null,
        montoFacturado,
        fechaVencimiento: p.fechaVencimiento,
        saldoPendiente: montoFacturado,
      },
    });
    return "creado";
  }

  if (existente.montoPagadoAcumulado.toNumber() > 0) {
    // Ya le abonaron algo a este cargo: no lo tocamos, para no descuadrar
    // lo que el cajero ya cobró. Un cambio de beca a mitad de camino se
    // maneja aparte (nota de crédito / ajuste manual), no sobrescribiendo.
    return "omitido_tiene_pagos";
  }

  const becaAplicadaId = becaResuelta?.estudianteBecaId ?? null;
  const sinCambios =
    existente.montoOriginal.toNumber() === p.montoBase &&
    existente.montoFacturado.toNumber() === montoFacturado &&
    existente.becaAplicadaId === becaAplicadaId;

  if (sinCambios) return "sin_cambios";

  await prisma.cargoEstudiante.update({
    where: { id: existente.id },
    data: {
      montoOriginal: p.montoBase,
      becaAplicadaId,
      montoFacturado,
      // Se conserva el recargo por mora ya aplicado (si lo había) al
      // recalcular el saldo pendiente.
      saldoPendiente: montoFacturado + existente.recargoMoraMonto.toNumber(),
    },
  });
  return "actualizado";
}

/**
 * ============================================================================
 * 1) FACTURACIÓN MENSUAL AUTOMÁTICA -- concepto "Mensualidad"
 * ============================================================================
 * Genera (o ajusta, si aún no tiene pagos) el cargo de mensualidad de un mes
 * para cada estudiante activo de un colegio, ya con su beca aplicada.
 *
 * Regla fija (7-sept-2026): se cobra el día 01 de cada mes. Por eso la
 * modalidad que se usa para decidir la cuenta contable es la que estaba
 * VIGENTE el día 01 de ESE mes (ver `obtenerModalidadVigente`) -- así, si un
 * alumno cambia de Secundaria Técnica a Regular a mitad de año, los meses ya
 * facturados no se alteran y los meses siguientes usan la tarifa nueva
 * automáticamente ("Flexibilidad Económica").
 *
 * Se puede correr de más sin miedo -- si el cargo del mes ya existe y ya
 * tiene pagos, simplemente se deja igual.
 */
export async function generarCargosMensuales(
  prisma: PrismaClient,
  params: { colegioId: number; anioLectivoId: number; mes: number; fechaEvaluacion?: Date }
): Promise<ResumenGeneracion> {
  if (params.mes < 1 || params.mes > 12) {
    throw new Error(`El mes debe estar entre 1 y 12 (recibido: ${params.mes}).`);
  }
  const fechaEvaluacion = params.fechaEvaluacion ?? new Date();
  const resumen = resumenVacio();

  const anioLectivo = await prisma.anioLectivo.findUniqueOrThrow({ where: { id: params.anioLectivoId } });
  const reglaMora = await obtenerReglaMoraVigente(prisma, params.colegioId, fechaEvaluacion);
  const mapaConceptos = await construirMapaDeConceptosPorModalidad(prisma);
  const fechaVencimiento = calcularFechaVencimiento(anioLectivo.anio, params.mes, reglaMora.diaLimitePago);
  // "01 de cada mes": el día en que se factura, para saber qué modalidad
  // (Regular vs Técnica, por ejemplo) estaba vigente justo ese día.
  const fechaFacturacion = new Date(Date.UTC(anioLectivo.anio, params.mes - 1, 1));

  const estudiantes = await prisma.estudiante.findMany({
    where: { colegioId: params.colegioId, activo: true, seccion: { anioLectivoId: params.anioLectivoId } },
  });

  for (const estudiante of estudiantes) {
    const modalidadVigente = await obtenerModalidadVigente(
      prisma,
      estudiante.id,
      estudiante.modalidadId,
      fechaFacturacion
    );
    const conceptos = mapaConceptos[modalidadVigente.nombre];
    const concepto = conceptos?.mensualidad;
    if (!concepto) {
      resumen.advertencias.push(
        `${estudiante.codigoEstudiantil} (${estudiante.nombreCompleto}): la modalidad "${modalidadVigente.nombre}" no tiene un Concepto de Arancel de Mensualidad configurado en prisma/data/modalidad-conceptos.json -- se omitió.`
      );
      continue;
    }
    const resultado = await crearOActualizarCargo(prisma, {
      estudianteId: estudiante.id,
      concepto,
      anioLectivoId: params.anioLectivoId,
      mes: params.mes,
      montoBase: estudiante.montoMensualidadBase.toNumber(),
      fechaVencimiento,
      fechaEvaluacion,
      advertencias: resumen.advertencias,
    });
    contabilizar(resumen, resultado);
  }

  const sinSeccion = await prisma.estudiante.count({
    where: { colegioId: params.colegioId, activo: true, seccionId: null },
  });
  if (sinSeccion > 0) {
    resumen.advertencias.push(
      `${sinSeccion} estudiante(s) activo(s) no tienen sección asignada, así que no se pudo saber a qué año lectivo pertenecen y no se les generó cargo. Asígnales una sección para incluirlos.`
    );
  }

  return resumen;
}

/**
 * ============================================================================
 * 1-bis) REGLA DE NOVIEMBRE/DICIEMBRE (regla fija, 7-sept-2026)
 * ============================================================================
 * El 01 de noviembre el sistema debe facturar Noviembre Y Diciembre AL MISMO
 * TIEMPO (en vez de esperar a diciembre para facturar ese mes). Esta función
 * es literalmente "correr generarCargosMensuales dos veces" -- la regla de
 * negocio real está en `puedeHacerExamenesNoviembre`, que es lo que
 * bloquea al alumno si no canceló AMBOS meses.
 */
export async function generarCargosNoviembreYDiciembre(
  prisma: PrismaClient,
  params: { colegioId: number; anioLectivoId: number; fechaEvaluacion?: Date }
): Promise<{ noviembre: ResumenGeneracion; diciembre: ResumenGeneracion }> {
  const noviembre = await generarCargosMensuales(prisma, { ...params, mes: 11 });
  const diciembre = await generarCargosMensuales(prisma, { ...params, mes: 12 });
  return { noviembre, diciembre };
}

/**
 * Regla restrictiva de cierre: un alumno solo puede presentarse a exámenes
 * finales de noviembre si tiene CANCELADOS (saldo pendiente = 0) tanto el
 * cargo de Mensualidad de noviembre COMO el de diciembre de ese año lectivo.
 * Se usa en la Pantalla de Cajera (para avisar) y se puede usar también en
 * cualquier pantalla de "control de exámenes" que se construya después.
 */
export async function puedeHacerExamenesNoviembre(
  prisma: PrismaClient,
  estudianteId: number,
  anioLectivoId: number
): Promise<{ puede: boolean; saldoNoviembre: number; saldoDiciembre: number }> {
  const cargos = await prisma.cargoEstudiante.findMany({
    where: {
      estudianteId,
      anioLectivoId,
      mes: { in: [11, 12] },
      concepto: { esRecurrenteMensual: true },
    },
  });
  const cargoNoviembre = cargos.find((c) => c.mes === 11);
  const cargoDiciembre = cargos.find((c) => c.mes === 12);
  const saldoNoviembre = cargoNoviembre?.saldoPendiente.toNumber() ?? 0;
  const saldoDiciembre = cargoDiciembre?.saldoPendiente.toNumber() ?? 0;
  // Si el cargo ni siquiera existe todavía, se cuenta como pendiente (no se
  // puede asumir que "no existe" significa "ya está pagado").
  const noviembreOk = !!cargoNoviembre && saldoNoviembre <= 0;
  const diciembreOk = !!cargoDiciembre && saldoDiciembre <= 0;
  return { puede: noviembreOk && diciembreOk, saldoNoviembre, saldoDiciembre };
}

/**
 * ============================================================================
 * 2) APERTURA ANUAL MASIVA -- Matrícula, Papelería y Décimo Tercer Mes
 * ============================================================================
 * Regla fija (7-sept-2026): estos 3 cargos se generan COMPLETOS al iniciar
 * el año escolar (o al promover a un alumno al año siguiente) -- no se
 * generan mes a mes. Se cobran UNA sola vez por año lectivo (mes = null en
 * `cargos_estudiante`). El vencimiento se toma de la fecha de ingreso del
 * estudiante si se conoce, o si no, del inicio del año lectivo.
 *
 * Cada concepto usa el monto de su propio campo en la "ficha dinámica" del
 * estudiante (`montoMatriculaBase`, `montoPapeleriaBase`,
 * `montoDecimoTercerBase`); si Papelería o Décimo Tercero no se fijaron
 * aparte (quedaron en null), se usa el mismo monto que Matrícula -- así
 * viene en el 99% de los casos reales del Excel, y la excepción puntual se
 * resuelve fijando ese campo específico en la ficha, no con una fórmula.
 */
export async function generarCargosUnicosAnuales(
  prisma: PrismaClient,
  params: {
    colegioId: number;
    anioLectivoId: number;
    conceptos?: Array<"matricula" | "papeleria" | "decimoTercero">;
    fechaEvaluacion?: Date;
  }
): Promise<ResumenGeneracion> {
  const conceptosAGenerar = params.conceptos ?? ["matricula", "papeleria", "decimoTercero"];
  const fechaEvaluacion = params.fechaEvaluacion ?? new Date();
  const resumen = resumenVacio();

  const anioLectivo = await prisma.anioLectivo.findUniqueOrThrow({ where: { id: params.anioLectivoId } });
  const mapaConceptos = await construirMapaDeConceptosPorModalidad(prisma);
  const fechaInicioAnio = anioLectivo.fechaInicio ?? new Date(Date.UTC(anioLectivo.anio, 0, 31));

  const estudiantes = await prisma.estudiante.findMany({
    where: { colegioId: params.colegioId, activo: true, seccion: { anioLectivoId: params.anioLectivoId } },
  });

  for (const estudiante of estudiantes) {
    const modalidadVigente = await obtenerModalidadVigente(
      prisma,
      estudiante.id,
      estudiante.modalidadId,
      fechaInicioAnio
    );
    const conceptosModalidad = mapaConceptos[modalidadVigente.nombre];
    if (!conceptosModalidad) {
      resumen.advertencias.push(
        `${estudiante.codigoEstudiantil}: la modalidad "${modalidadVigente.nombre}" no está en prisma/data/modalidad-conceptos.json -- se omitió.`
      );
      continue;
    }
    const fechaVencimiento = estudiante.fechaIngreso ?? fechaInicioAnio;
    const montosBase: Record<"matricula" | "papeleria" | "decimoTercero", number> = {
      matricula: estudiante.montoMatriculaBase.toNumber(),
      papeleria: (estudiante.montoPapeleriaBase ?? estudiante.montoMatriculaBase).toNumber(),
      decimoTercero: (estudiante.montoDecimoTercerBase ?? estudiante.montoMatriculaBase).toNumber(),
    };

    for (const clave of conceptosAGenerar) {
      const concepto = conceptosModalidad[clave];
      if (!concepto) continue; // esa modalidad no cobra este concepto (ej. ICCM no cobra Matrícula/Papelería aparte)
      const resultado = await crearOActualizarCargo(prisma, {
        estudianteId: estudiante.id,
        concepto,
        anioLectivoId: params.anioLectivoId,
        mes: null,
        montoBase: montosBase[clave],
        fechaVencimiento,
        fechaEvaluacion,
        advertencias: resumen.advertencias,
      });
      contabilizar(resumen, resultado);
    }
  }

  return resumen;
}
