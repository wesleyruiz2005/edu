/**
 * Utilidades chiquitas para leer los argumentos "--nombre=valor" que se le
 * pasan a los scripts desde la terminal, ej.:
 *   npm run facturar:mensual -- --colegio=CMLM --anio=2026 --mes=9
 */
export function leerArgumento(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  const arg = process.argv.find((a) => a.startsWith(prefijo));
  return arg?.slice(prefijo.length);
}

export function leerArgumentoNumerico(nombre: string): number | undefined {
  const valor = leerArgumento(nombre);
  if (valor === undefined) return undefined;
  const n = Number(valor);
  if (Number.isNaN(n)) throw new Error(`El argumento --${nombre} debe ser un número (recibido: "${valor}").`);
  return n;
}

export function requerirArgumento(nombre: string): string {
  const valor = leerArgumento(nombre);
  if (valor === undefined) {
    throw new Error(`Falta el argumento --${nombre}=... Ejemplo: --${nombre}=valor`);
  }
  return valor;
}

export function requerirArgumentoNumerico(nombre: string): number {
  const valor = requerirArgumento(nombre);
  const n = Number(valor);
  if (Number.isNaN(n)) throw new Error(`El argumento --${nombre} debe ser un número (recibido: "${valor}").`);
  return n;
}
