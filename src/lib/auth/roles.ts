/**
 * ============================================================================
 * MAPA DE MÓDULOS <-> ROLES -- única fuente de verdad de "quién ve qué"
 * ============================================================================
 * Tanto `src/middleware.ts` (bloquea el acceso por URL) como el menú de
 * `src/app/layout.tsx`/`src/app/page.tsx` (muestran solo lo que a cada
 * quien le corresponde) leen de esta misma lista -- así nunca se puede dar
 * el caso de un link visible a una pantalla bloqueada, o viceversa.
 *
 * Reglas de acceso pedidas por Eduardo (7 sept 2026):
 *   - CAJERA: acceso EXCLUSIVO a la Pantalla de Cajera.
 *   - CONTADOR: Libro Diario, Libro Mayor, Cierres, Egresos/Proveedores
 *     (con retenciones) y Retenciones DGI.
 *   - JUNTA_DIRECTIVA: Dashboard Consolidado (3 sedes) + auditoría ICCM.
 *
 * Nota: Eduardo no mencionó quién ve "Nóminas" -- se dejó dentro del rol
 * Contador por ser lo más cercano a su función (es quien jornaliza la
 * planilla). Si prefiere otra cosa, se cambia acá en una sola línea.
 */
import type { RolUsuarioApp } from "./sesion-nucleo";

export interface ModuloApp {
  href: string;
  /** Título largo -- se usa en la tarjeta de Inicio. */
  titulo: string;
  /** Título corto -- se usa en el link del menú de arriba (no le entra el título largo). */
  tituloCorto: string;
  descripcion: string;
  emoji: string;
  roles: RolUsuarioApp[];
}

export const MODULOS_APP: ModuloApp[] = [
  {
    href: "/caja",
    titulo: "Pantalla de Cajera (Punto de Venta)",
    tituloCorto: "Cajera",
    descripcion:
      "Buscar alumno por Código NC, ver saldos vencidos, cobrar mensualidad/matrícula/uniformes/anticipos, emitir el ROC y enviar recordatorio de cobro por WhatsApp al tutor.",
    emoji: "💵",
    roles: ["CAJERA"],
  },
  {
    href: "/egresos",
    titulo: "Egresos y Proveedores",
    tituloCorto: "Egresos y Proveedores",
    descripcion:
      "Registrar un pago a proveedor con retención automática (2%/10%), historial de cuentas usadas y jornalización automática.",
    emoji: "🧾",
    roles: ["CONTADOR"],
  },
  {
    href: "/nomina",
    titulo: "Nóminas",
    tituloCorto: "Nóminas",
    descripcion:
      "Planillas de los 3 colegios (Personal Fijo, Docente por Hora, El Buen Pastor INSS/No-INSS), descargables en Excel con bruto, deducciones INSS/IR y neto.",
    emoji: "👥",
    roles: ["CONTADOR"],
  },
  {
    href: "/dgi",
    titulo: "Retenciones DGI",
    tituloCorto: "Retenciones DGI",
    descripcion:
      "Reporte mensual de retenciones (2%/10% proveedores + 10% docentes por hora) listo para la declaración fiscal, exportable a Excel.",
    emoji: "🏛️",
    roles: ["CONTADOR"],
  },
  {
    href: "/contador",
    titulo: "Libro Diario, Libro Mayor y Cierres",
    tituloCorto: "Libro y Cierres",
    descripcion:
      "Jornalización cronológica, mayor por cuenta contable, y cierre mensual/anual con validación de cuadre (\"OK - Cuadrado\").",
    emoji: "📚",
    roles: ["CONTADOR"],
  },
  {
    href: "/dashboard",
    titulo: "Dashboard Consolidado -- Junta Directiva",
    tituloCorto: "Dashboard Junta",
    descripcion:
      "Indicadores globales, ingresos por sede, top de morosidad, los 5 estados financieros en Excel, y la auditoría especial ICCM (retenidos + comisiones BAC).",
    emoji: "📊",
    roles: ["JUNTA_DIRECTIVA"],
  },
];

export function modulosPermitidosParaRol(rol: RolUsuarioApp): ModuloApp[] {
  return MODULOS_APP.filter((m) => m.roles.includes(rol));
}

/** ¿Puede este rol entrar a esta URL? "/" (Inicio) siempre está permitido -- ahí se ve el menú ya filtrado. */
export function rutaPermitidaParaRol(pathname: string, rol: RolUsuarioApp): boolean {
  if (pathname === "/") return true;
  return modulosPermitidosParaRol(rol).some((m) => pathname === m.href || pathname.startsWith(m.href + "/"));
}

export function nombreRol(rol: RolUsuarioApp): string {
  switch (rol) {
    case "CAJERA":
      return "Cajera";
    case "CONTADOR":
      return "Contador";
    case "JUNTA_DIRECTIVA":
      return "Junta Directiva";
  }
}
