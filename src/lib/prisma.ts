/**
 * Conexión única (singleton) a la base de datos.
 *
 * ¿Por qué un archivo separado para esto? Porque en Next.js, cada vez que
 * se recarga código en desarrollo se podría crear una nueva conexión a la
 * base de datos si no se reutiliza la misma instancia -- con el tiempo eso
 * agota las conexiones disponibles en Supabase. Este patrón (recomendado
 * por la propia documentación de Prisma) guarda una sola instancia y la
 * reutiliza siempre.
 */
import { PrismaClient } from "@prisma/client";

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalParaPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = prisma;
}
