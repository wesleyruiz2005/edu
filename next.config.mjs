/** @type {import('next').NextConfig} */
const nextConfig = {
  // El proyecto usa Server Actions (App Router) para conectar las pantallas
  // con la lógica contable en src/lib -- no hace falta configurar nada
  // extra por ahora, se deja el archivo explícito para el día que sí haga
  // falta (dominios de imágenes, redirecciones, etc.).
  reactStrictMode: true,
};

export default nextConfig;
