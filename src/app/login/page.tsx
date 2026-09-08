import PantallaLogin from "../../components/auth/PantallaLogin";

// El middleware ya se encarga de mandar para "/" a quien ya tiene sesión
// activa y trata de volver a entrar acá -- esta página solo dibuja el
// formulario.
export default function LoginPage() {
  return <PantallaLogin />;
}
