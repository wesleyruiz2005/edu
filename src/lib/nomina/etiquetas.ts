const NOMBRES_TIPO_NOMINA: Record<string, string> = {
  DOCENTE_HORARIO: "Docente por Hora",
  CONTRATO_SERVICIOS_GENERALES: "Contrato Servicios Generales",
  PERSONAL_FIJO: "Personal Fijo",
  DOCENTE_INSS: "Personal Inscrito al INSS",
  DOCENTE_NO_INSS: "Personal No Inscrito al INSS",
};

export function nombreTipoNomina(tipo: string): string {
  return NOMBRES_TIPO_NOMINA[tipo] ?? tipo;
}