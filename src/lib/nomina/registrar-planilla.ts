/**
 * ============================================================================
 * MÓDULO DE NÓMINAS -- con tasas reales confirmadas (7 sept 2026)
 * ============================================================================
 * Ver `inss-ir.ts` para las tasas/tabla y cómo se confirmaron. Este archivo
 * arma la planilla mensual por empleado y su jornalización, usando las
 * cuentas DETALLE reales del catálogo:
 *
 *   PERSONAL_FIJO / DOCENTE_INSS -- SIN piso de cotización (El Mesías, Instituto):
 *     Débito  6020101 Sueldos Y Salarios  = salarioBruto
 *     Débito  60203 Inss Patronal (gasto) = inssPatronal
 *     Débito  60204 Inatec (gasto)        = inatecPatronal (si se activa)
 *     Crédito 210601 Inss Laboral (pasivo)     = inssLaboral
 *     Crédito 21070401 Inss Patronal (pasivo)  = inssPatronal
 *     Crédito 21070402 Inatec (pasivo)         = inatecPatronal (si se activa)
 *     Crédito 21060201 IR Empleados (pasivo)   = irMensual
 *     Crédito Caja/Banco                       = neto
 *
 *   DOCENTE_INSS -- CON piso de cotización (El Buen Pastor, `opciones.pisoCotizacionMensual`):
 *     confirmado exacto (24/24) contra la hoja "Decla. Inss [Mes]" real:
 *     Débito  6020101 Sueldos Y Salarios  = salarioBruto
 *     Débito  60203 Inss Patronal (gasto) = inssPatronal + subsidioInssPiso (el colegio
 *             absorbe la diferencia entre el 7% del salario real y el 7% del piso mínimo)
 *     Crédito 210601 Inss Laboral (pasivo)  = inssLaboral (deducido al empleado) + subsidioInssPiso
 *             (juntos = lo que realmente hay que declarar/pagar al INSS por la cuota laboral)
 *     Crédito 21070401 Inss Patronal (pasivo) = inssPatronal (ya calculado sobre el piso)
 *     Crédito 21060201 IR Empleados (pasivo)  = irMensual
 *     Crédito Caja/Banco                      = neto (usa SOLO el 7% del salario real -- el
 *             empleado nunca ve reducido su cheque por el subsidio)
 *
 *   DOCENTE_NO_INSS (Buen Pastor, confirmado exacto: 0 INSS en las 2 planillas No-INSS reales):
 *     Débito  6020101 Sueldos Y Salarios = salarioBruto
 *     Crédito 21060201 IR Empleados      = irMensual (si aplica)
 *     Crédito Caja/Banco                 = neto
 *
 *   DOCENTE_HORARIO ("Servicio Profesional", Instituto):
 *     Débito  60210 Servicios Profesionales = salarioBruto
 *     Crédito 21060203 IR Servicios Profesionales = 10%
 *     Crédito Caja/Banco = neto
 *
 *   CONTRATO_SERVICIOS_GENERALES ("Servicio General", Instituto):
 *     Débito  60211 Servicios Generales y técnicos = salarioBruto
 *     Crédito 21060202 IR Compra De Bienes Y Servicios = 2%
 *     Crédito Caja/Banco = neto
 */
import type { PrismaClient, LibroContable, TipoNomina } from "@prisma/client";
import { obtenerCuenta, siguienteNumeroAsientoMensual } from "../caja/comprobante-utils";
import { crearComprobanteBalanceado, agruparPorCuenta } from "../caja/procesar-pago";
import {
  calcularInssLaboral,
  calcularInssPatronal,
  calcularInatecPatronal,
  calcularIrMensual,
  calcularInssConPisoCotizacion,
  TASA_RETENCION_SERVICIO_PROFESIONAL,
  TASA_RETENCION_SERVICIO_GENERAL,
} from "./inss-ir";

const CUENTA_SUELDOS_Y_SALARIOS = "6020101";
const CUENTA_SERVICIOS_PROFESIONALES_GASTO = "60210";
const CUENTA_SERVICIOS_GENERALES_GASTO = "60211";
const CUENTA_INSS_PATRONAL_GASTO = "60203";
const CUENTA_INATEC_GASTO = "60204";
const CUENTA_INSS_LABORAL_PASIVO = "210601";
const CUENTA_INSS_PATRONAL_PASIVO = "21070401";
const CUENTA_INATEC_PASIVO = "21070402";
const CUENTA_IR_EMPLEADOS_PASIVO = "21060201";
const CUENTA_IR_SERVICIOS_PROFESIONALES_PASIVO = "21060203";
const CUENTA_IR_COMPRA_BIENES_SERVICIOS_PASIVO = "21060202";

function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface DeduccionesNomina {
  inssLaboral: number;
  inssPatronal: number;
  inatecPatronal: number;
  irMensual: number;
  /** Solo DOCENTE_INSS con `pisoCotizacionMensual`: lo que el colegio absorbe como gasto adicional para completar la cotización mínima del empleado. 0 en todos los demás casos/esquemas. */
  subsidioInssPiso: number;
  porcentajeRetencionServicios: number;
  montoRetencionServicios: number;
  salarioNeto: number;
}

export interface OpcionesCalculoNomina {
  /** "Viáticos Transporte" del periodo -- se excluyen de la base de INSS Laboral (igual que el Excel real). */
  viaticosTransporte?: number;
  /** true si el colegio ya tiene 50+ trabajadores (sube el INSS Patronal de 21.5% a 22.5%). Ninguno de los 3 colegios lo tiene hoy. */
  empleadosDelColegio50OMas?: boolean;
  /** Los 3 Excel reales de Eduardo NO aplican INATEC (lo traen en 0) -- por eso queda apagado salvo que se active explícitamente. */
  aplicarInatec?: boolean;
  /**
   * Solo El Buen Pastor (DOCENTE_INSS): "piso de cotización" mensual --
   * cuando se da, el INSS Laboral/Patronal que hay que PAGAR al INSS se
   * calcula sobre el mayor entre el salario real y este piso (ver
   * `calcularInssConPisoCotizacion` en `inss-ir.ts`), aunque al empleado
   * solo se le deduce el 7% de su salario real. Pasar
   * `PISO_COTIZACION_DOCENCIA_MENSUAL` de `inss-ir.ts`. Si se omite (El
   * Mesías/Instituto), no hay piso -- se cotiza siempre sobre el real.
   */
  pisoCotizacionMensual?: number;
}

/** Calcula todas las deducciones/gastos patronales de UN empleado según su tipo de nómina, con las tasas reales confirmadas. */
export function calcularDeduccionesNomina(
  tipoNomina: TipoNomina,
  salarioBruto: number,
  opciones?: OpcionesCalculoNomina
): DeduccionesNomina {
  const aplicarInatec = opciones?.aplicarInatec ?? false;

  switch (tipoNomina) {
    case "DOCENTE_HORARIO": {
      const monto = redondear(salarioBruto * TASA_RETENCION_SERVICIO_PROFESIONAL);
      return {
        inssLaboral: 0,
        inssPatronal: 0,
        inatecPatronal: 0,
        irMensual: 0,
        subsidioInssPiso: 0,
        porcentajeRetencionServicios: TASA_RETENCION_SERVICIO_PROFESIONAL * 100,
        montoRetencionServicios: monto,
        salarioNeto: redondear(salarioBruto - monto),
      };
    }
    case "CONTRATO_SERVICIOS_GENERALES": {
      const monto = redondear(salarioBruto * TASA_RETENCION_SERVICIO_GENERAL);
      return {
        inssLaboral: 0,
        inssPatronal: 0,
        inatecPatronal: 0,
        irMensual: 0,
        subsidioInssPiso: 0,
        porcentajeRetencionServicios: TASA_RETENCION_SERVICIO_GENERAL * 100,
        montoRetencionServicios: monto,
        salarioNeto: redondear(salarioBruto - monto),
      };
    }
    case "DOCENTE_NO_INSS": {
      // Confirmado exacto contra las 2 planillas No-INSS reales de El Buen Pastor
      // (enero-marzo 2026, 48/48 quincenas con INSS Laboral = C$0): sin INSS, solo IR si el salario lo amerita.
      const ir = calcularIrMensual(salarioBruto, 0);
      return {
        inssLaboral: 0,
        inssPatronal: 0,
        inatecPatronal: 0,
        irMensual: ir,
        subsidioInssPiso: 0,
        porcentajeRetencionServicios: 0,
        montoRetencionServicios: 0,
        salarioNeto: redondear(salarioBruto - ir),
      };
    }
    case "DOCENTE_INSS": {
      // El Buen Pastor, personal inscrito al INSS -- SÍ usa el "piso de
      // cotización" (ver `calcularInssConPisoCotizacion`), confirmado
      // exacto (24/24) contra la hoja real "Decla. Inss [Mes]".
      if (opciones?.pisoCotizacionMensual) {
        const r = calcularInssConPisoCotizacion(salarioBruto, opciones.pisoCotizacionMensual, opciones?.empleadosDelColegio50OMas ?? false);
        const irMensual = calcularIrMensual(salarioBruto, r.inssLaboralDeducidoAlEmpleado);
        return {
          inssLaboral: r.inssLaboralDeducidoAlEmpleado,
          inssPatronal: r.inssPatronalPorPagar,
          inatecPatronal: aplicarInatec ? calcularInatecPatronal(r.salarioBaseCotizable) : 0,
          irMensual,
          subsidioInssPiso: r.subsidioInssAsumidoPorElColegio,
          porcentajeRetencionServicios: 0,
          montoRetencionServicios: 0,
          salarioNeto: redondear(salarioBruto - r.inssLaboralDeducidoAlEmpleado - irMensual),
        };
      }
      // Sin piso configurado, DOCENTE_INSS se comporta como PERSONAL_FIJO (cae al caso por defecto).
    }
    // falls through intentionally cuando DOCENTE_INSS no trae `pisoCotizacionMensual`
    case "PERSONAL_FIJO":
    default: {
      const inssLaboral = calcularInssLaboral(salarioBruto, opciones?.viaticosTransporte ?? 0);
      const inssPatronal = calcularInssPatronal(salarioBruto, opciones?.empleadosDelColegio50OMas ?? false);
      const inatecPatronal = aplicarInatec ? calcularInatecPatronal(salarioBruto) : 0;
      const irMensual = calcularIrMensual(salarioBruto, inssLaboral);
      return {
        inssLaboral,
        inssPatronal,
        inatecPatronal,
        irMensual,
        subsidioInssPiso: 0,
        porcentajeRetencionServicios: 0,
        montoRetencionServicios: 0,
        salarioNeto: redondear(salarioBruto - inssLaboral - irMensual),
      };
    }
  }
}

export interface DetalleEmpleadoPlanilla {
  empleadoId: number;
  horasOClases?: number;
  /** "Total Ingresos" del periodo (salario ordinario + feriados + subsidio + vacaciones, sin viáticos). */
  salarioBruto: number;
  observacion?: string;
}

export interface ParametrosPlanillaMensual {
  colegioId: number;
  tipoNomina: TipoNomina;
  anio: number;
  mes: number;
  detalle: DetalleEmpleadoPlanilla[];
  opciones?: OpcionesCalculoNomina;
}

export interface ResultadoPlanillaMensual {
  planillaId: number;
  totalBruto: number;
  totalDeducidoEmpleados: number;
  totalGastoPatronalAdicional: number;
  totalNeto: number;
}

/** Arma/actualiza la planilla del mes (todavía ABIERTA, sin jornalizar) -- calcula INSS/IR/retención y neto por empleado con las tasas reales. */
export async function registrarPlanillaMensual(
  prisma: PrismaClient,
  params: ParametrosPlanillaMensual
): Promise<ResultadoPlanillaMensual> {
  if (params.detalle.length === 0) {
    throw new Error("La planilla no tiene ningún empleado.");
  }

  return prisma.$transaction(async (tx) => {
    const planilla = await tx.planillaMensual.upsert({
      where: { colegioId_tipoNomina_anio_mes: { colegioId: params.colegioId, tipoNomina: params.tipoNomina, anio: params.anio, mes: params.mes } },
      create: { colegioId: params.colegioId, tipoNomina: params.tipoNomina, anio: params.anio, mes: params.mes },
      update: {},
    });
    if (planilla.estado === "CERRADO") {
      throw new Error(`La planilla de ${params.mes}/${params.anio} (${params.tipoNomina}) ya está cerrada y jornalizada -- no se puede editar.`);
    }

    let totalBruto = 0;
    let totalDeducidoEmpleados = 0;
    let totalGastoPatronalAdicional = 0;
    let totalNeto = 0;

    for (const d of params.detalle) {
      const calc = calcularDeduccionesNomina(params.tipoNomina, d.salarioBruto, params.opciones);

      await tx.planillaDetalle.upsert({
        where: { planillaId_empleadoId: { planillaId: planilla.id, empleadoId: d.empleadoId } },
        create: {
          planillaId: planilla.id,
          empleadoId: d.empleadoId,
          horasOClases: d.horasOClases,
          salarioBruto: d.salarioBruto,
          inssLaboral: calc.inssLaboral,
          inssPatronal: calc.inssPatronal,
          inatecPatronal: calc.inatecPatronal,
          irMensual: calc.irMensual,
          subsidioInssPiso: calc.subsidioInssPiso,
          porcentajeRetencion: calc.porcentajeRetencionServicios,
          montoRetencion: calc.montoRetencionServicios,
          salarioNeto: calc.salarioNeto,
          observacion: d.observacion,
        },
        update: {
          horasOClases: d.horasOClases,
          salarioBruto: d.salarioBruto,
          inssLaboral: calc.inssLaboral,
          inssPatronal: calc.inssPatronal,
          inatecPatronal: calc.inatecPatronal,
          irMensual: calc.irMensual,
          subsidioInssPiso: calc.subsidioInssPiso,
          porcentajeRetencion: calc.porcentajeRetencionServicios,
          montoRetencion: calc.montoRetencionServicios,
          salarioNeto: calc.salarioNeto,
          observacion: d.observacion,
        },
      });

      totalBruto += d.salarioBruto;
      totalDeducidoEmpleados += calc.inssLaboral + calc.irMensual + calc.montoRetencionServicios;
      totalGastoPatronalAdicional += calc.inssPatronal + calc.inatecPatronal + calc.subsidioInssPiso;
      totalNeto += calc.salarioNeto;
    }

    return {
      planillaId: planilla.id,
      totalBruto: redondear(totalBruto),
      totalDeducidoEmpleados: redondear(totalDeducidoEmpleados),
      totalGastoPatronalAdicional: redondear(totalGastoPatronalAdicional),
      totalNeto: redondear(totalNeto),
    };
  });
}

export interface ParametrosJornalizarPlanilla {
  colegioId: number;
  libro?: LibroContable; // default "COLEGIO"
  tipoNomina: TipoNomina;
  anio: number;
  mes: number;
  fechaPago: Date;
  /** Código de la cuenta de la que sale el neto pagado (Caja General o el banco). */
  cuentaOrigenCodigo: string;
  formaPago: "CAJA_GENERAL" | "TRANSFERENCIA" | "CHEQUE";
  numeroCheque?: string;
}

/** Elige la cuenta de gasto y la cuenta de retención/pasivo de IR según el tipo de nómina. */
function cuentasPorTipoNomina(tipoNomina: TipoNomina) {
  switch (tipoNomina) {
    case "DOCENTE_HORARIO":
      return { cuentaGasto: CUENTA_SERVICIOS_PROFESIONALES_GASTO, cuentaRetencionServicios: CUENTA_IR_SERVICIOS_PROFESIONALES_PASIVO };
    case "CONTRATO_SERVICIOS_GENERALES":
      return { cuentaGasto: CUENTA_SERVICIOS_GENERALES_GASTO, cuentaRetencionServicios: CUENTA_IR_COMPRA_BIENES_SERVICIOS_PASIVO };
    default:
      return { cuentaGasto: CUENTA_SUELDOS_Y_SALARIOS, cuentaRetencionServicios: null };
  }
}

/** Cierra la planilla del mes y genera su asiento contable (Débito Gasto(s), Crédito INSS/IR/Retención + Crédito Caja/Banco). */
export async function jornalizarPlanilla(prisma: PrismaClient, params: ParametrosJornalizarPlanilla) {
  const libro = params.libro ?? "COLEGIO";
  if (params.formaPago === "CHEQUE" && !params.numeroCheque) {
    throw new Error('Falta el número de cheque -- obligatorio cuando la forma de pago es "Cheque".');
  }

  return prisma.$transaction(async (tx) => {
    const planilla = await tx.planillaMensual.findUnique({
      where: { colegioId_tipoNomina_anio_mes: { colegioId: params.colegioId, tipoNomina: params.tipoNomina, anio: params.anio, mes: params.mes } },
      include: { detalle: true },
    });
    if (!planilla) throw new Error(`No existe planilla de ${params.mes}/${params.anio} (${params.tipoNomina}) -- créala primero con registrarPlanillaMensual().`);
    if (planilla.estado === "CERRADO") throw new Error(`Esa planilla ya está jornalizada (comprobante ya generado).`);
    if (planilla.detalle.length === 0) throw new Error("La planilla no tiene empleados -- no hay nada que jornalizar.");

    const totalBruto = planilla.detalle.reduce((s, d) => s + d.salarioBruto.toNumber(), 0);
    const totalInssLaboral = planilla.detalle.reduce((s, d) => s + d.inssLaboral.toNumber(), 0);
    const totalInssPatronal = planilla.detalle.reduce((s, d) => s + d.inssPatronal.toNumber(), 0);
    const totalInatec = planilla.detalle.reduce((s, d) => s + d.inatecPatronal.toNumber(), 0);
    const totalIrMensual = planilla.detalle.reduce((s, d) => s + d.irMensual.toNumber(), 0);
    const totalSubsidioInssPiso = planilla.detalle.reduce((s, d) => s + d.subsidioInssPiso.toNumber(), 0);
    const totalRetencionServicios = planilla.detalle.reduce((s, d) => s + d.montoRetencion.toNumber(), 0);
    const totalNeto = planilla.detalle.reduce((s, d) => s + d.salarioNeto.toNumber(), 0);
    // El Buen Pastor (DOCENTE_INSS con piso): lo que el colegio DECLARA/PAGA
    // al INSS por la cuota laboral es el 7% deducido al empleado MÁS el
    // subsidio que el colegio pone de su bolsillo para llegar al piso
    // mínimo de cotización -- ver `calcularInssConPisoCotizacion`.
    const totalInssLaboralPorPagar = redondear(totalInssLaboral + totalSubsidioInssPiso);
    const totalInssPatronalGasto = redondear(totalInssPatronal + totalSubsidioInssPiso);

    const { cuentaGasto: codigoCuentaGasto, cuentaRetencionServicios: codigoRetencionServicios } = cuentasPorTipoNomina(params.tipoNomina);

    const cuentaGasto = await obtenerCuenta(tx, libro, codigoCuentaGasto);
    const cuentaOrigen = await obtenerCuenta(tx, libro, params.cuentaOrigenCodigo);

    const debitos = [{ cuentaId: cuentaGasto.id, monto: totalBruto }];
    if (totalInssPatronalGasto > 0) {
      // Incluye el subsidio del piso de cotización (si aplica) en la misma
      // cuenta de gasto de INSS Patronal -- avisar a Eduardo si prefiere una
      // sub-cuenta separada ("Subsidio INSS piso mínimo") para verlo aparte.
      const cuentaInssPatronalGasto = await obtenerCuenta(tx, libro, CUENTA_INSS_PATRONAL_GASTO);
      debitos.push({ cuentaId: cuentaInssPatronalGasto.id, monto: totalInssPatronalGasto });
    }
    if (totalInatec > 0) {
      const cuentaInatecGasto = await obtenerCuenta(tx, libro, CUENTA_INATEC_GASTO);
      debitos.push({ cuentaId: cuentaInatecGasto.id, monto: totalInatec });
    }

    const creditos: { cuentaId: number; monto: number }[] = [{ cuentaId: cuentaOrigen.id, monto: totalNeto }];
    if (totalInssLaboralPorPagar > 0) {
      const cuentaInssLaboralPasivo = await obtenerCuenta(tx, libro, CUENTA_INSS_LABORAL_PASIVO);
      creditos.push({ cuentaId: cuentaInssLaboralPasivo.id, monto: totalInssLaboralPorPagar });
    }
    if (totalInssPatronal > 0) {
      const cuentaInssPatronalPasivo = await obtenerCuenta(tx, libro, CUENTA_INSS_PATRONAL_PASIVO);
      creditos.push({ cuentaId: cuentaInssPatronalPasivo.id, monto: totalInssPatronal });
    }
    if (totalInatec > 0) {
      const cuentaInatecPasivo = await obtenerCuenta(tx, libro, CUENTA_INATEC_PASIVO);
      creditos.push({ cuentaId: cuentaInatecPasivo.id, monto: totalInatec });
    }
    if (totalIrMensual > 0) {
      const cuentaIrEmpleados = await obtenerCuenta(tx, libro, CUENTA_IR_EMPLEADOS_PASIVO);
      creditos.push({ cuentaId: cuentaIrEmpleados.id, monto: totalIrMensual });
    }
    if (totalRetencionServicios > 0 && codigoRetencionServicios) {
      const cuentaRetencionServicios = await obtenerCuenta(tx, libro, codigoRetencionServicios);
      creditos.push({ cuentaId: cuentaRetencionServicios.id, monto: totalRetencionServicios });
    }

    const anio = params.fechaPago.getUTCFullYear();
    const mes = params.fechaPago.getUTCMonth() + 1;
    let tipoComprobante: "CD" | "CK";
    let claveComprobanteOverride: string;
    if (params.formaPago === "CHEQUE") {
      tipoComprobante = "CK";
      claveComprobanteOverride = params.numeroCheque!;
    } else {
      tipoComprobante = "CD";
      claveComprobanteOverride = await siguienteNumeroAsientoMensual(tx, { colegioId: params.colegioId, libro, anio, mes });
    }

    const comprobante = await crearComprobanteBalanceado(tx, {
      colegioId: params.colegioId,
      libro,
      tipoComprobante,
      origen: "AUTO_NOMINA",
      fecha: params.fechaPago,
      concepto: `Planilla ${params.tipoNomina} ${params.mes}/${params.anio} -- ${planilla.detalle.length} empleado(s).`,
      debitos: agruparPorCuenta(debitos),
      creditos: agruparPorCuenta(creditos),
      noCheque: params.formaPago === "CHEQUE" ? params.numeroCheque : undefined,
      claveComprobanteOverride,
    });

    await tx.planillaMensual.update({
      where: { id: planilla.id },
      data: { estado: "CERRADO", comprobanteId: comprobante.comprobanteId },
    });

    return {
      comprobanteId: comprobante.comprobanteId,
      claveComprobante: comprobante.claveComprobante,
      totalBruto,
      totalInssLaboral,
      totalInssPatronal,
      totalInatec,
      totalIrMensual,
      totalSubsidioInssPiso,
      totalRetencionServicios,
      totalNeto,
    };
  });
}
