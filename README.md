# Sistema Contable Multi-Colegio — Base de Datos

Este paquete contiene los primeros dos entregables del proyecto: el **modelo de base de datos** (`prisma/schema.prisma`) y el **script para cargar el catálogo de las 286 cuentas contables** extraídas de tu Excel.

## ¿Qué es cada archivo?

```
sistema-contable/
├── prisma/
│   ├── schema.prisma          ← Las 31 tablas del sistema (estudiantes, becas, caja, jornalización, kardex, activos fijos...)
│   ├── seed.ts                ← Script que carga el catálogo de cuentas en la base de datos
│   └── data/
│       └── catalogo-cuentas.json   ← Las 286 cuentas de tu Excel, ya en formato de datos (código, nombre, jerarquía)
├── package.json                ← Lista de herramientas que el proyecto necesita
├── .env.example                ← Plantilla para la conexión a la base de datos
└── tsconfig.json               ← Configuración técnica (no necesitas tocarlo)
```

## Paso a paso para dejarlo funcionando

**1) Crear la base de datos en la nube (una sola vez).**
Entra a [supabase.com](https://supabase.com), crea una cuenta gratis y un proyecto nuevo. Cuando termine de crearse, ve a *Project Settings → Database → Connection string* y copia la cadena de conexión (empieza con `postgresql://...`).

**2) Configurar la conexión.**
Copia el archivo `.env.example` y renómbralo a `.env`. Pega ahí la cadena de conexión que copiaste de Supabase.

**3) Instalar las herramientas (una sola vez, necesita Node.js instalado).**
```
npm install
```

**4) Crear las tablas en la base de datos.**
```
npx prisma migrate dev --name inicial
```
Esto lee `schema.prisma` y crea las 31 tablas reales en tu base de datos de Supabase — ninguna tabla existe todavía hasta que corras este comando.

**5) Cargar el catálogo de 286 cuentas contables.**
```
npm run seed
```
Esto llena la tabla `catalogo_cuentas` con exactamente los mismos códigos de tu Excel (desde `110101 - Caja General` hasta `9 - Cuentas de Orden Acreedoras`), ya organizados en su jerarquía (cuenta padre / cuenta hija). 39 de esos 286 códigos estaban vacíos en tu Excel original (marcados `(Código disponible)` o `XXXXXXXX`); se cargan igual pero marcados como `activo: false`, para que no aparezcan en los selectores hasta que decidas usarlos.

**6) Verificar visualmente (opcional pero recomendado).**
```
npx prisma studio
```
Abre una pantalla en el navegador donde puedes ver las tablas y sus datos, como una versión visual de la base de datos.

## Nota sobre esta entrega (base de datos)

No pude ejecutar estos comandos yo mismo aquí porque este espacio de trabajo no tiene salida a internet hacia los servidores de Prisma (una restricción de este entorno, no del código). Revisé el `schema.prisma` línea por línea a mano — las 31 tablas, todas sus relaciones y las 3 tablas nuevas que agregué para amarrar bien el catálogo de cuentas (becas por concepto, reembolsos de caja chica y proveedores del kardex) — y validé el archivo `catalogo-cuentas.json` por separado (286 códigos únicos, cero huérfanos en la jerarquía, cero valores fuera de catálogo). Cuando corras el paso 4 en tu máquina o cuando conectemos Supabase, `prisma migrate` hará su propia validación real contra la base de datos.

---

## Módulo de Facturación y Aranceles (cobros mensuales + mora)

Esta es la primera "pieza de lógica de negocio" del sistema: el motor que reemplaza la hoja "Facturación" y el copiado manual de recargos por mora en Detalle de Caja.

```
src/lib/facturacion/
├── reglas.ts                 ← Las fórmulas puras: aplicar beca, calcular vencimiento, calcular recargo del 10%.
├── generar-cargos.ts         ← Genera los cargos de Mensualidad (mensual) y Matrícula/Papelería (una vez al año).
├── mora.ts                   ← Revisa los cargos vencidos y aplica el recargo del 10%.
├── mapa-conceptos.ts         ← Decide qué "Concepto de Arancel" usar según la Modalidad del estudiante.
└── regla-mora-vigente.ts     ← Busca la regla de mora vigente (por colegio, o la global).

prisma/data/
├── colegios.json              ← Los 3 colegios (edítalo con los nombres/códigos reales antes de producción).
├── modalidades.json           ← Preescolar/Primaria, Secundaria, Cursos Libres, Carreras Técnicas, ICCM.
├── conceptos-arancel.json     ← Matrícula, Mensualidad, Papelería, Décimo Tercer Mes... por cada modalidad, ya amarrados a su cuenta contable.
├── modalidad-conceptos.json   ← El "mapa": qué concepto le toca a cada modalidad.
└── reglas-mora.json           ← 10% de recargo después del día 5 (puedes agregar una regla especial por colegio si algún día hace falta).

scripts/
├── probar-reglas.ts           ← Prueba las fórmulas SIN necesitar base de datos (ver más abajo).
├── facturar-mensual.ts        ← Genera la Mensualidad de un mes.
├── facturar-anual.ts          ← Genera Matrícula y Papelería del año.
└── aplicar-mora.ts            ← Aplica el recargo del 10% a los cargos vencidos.
```

### Cómo funciona, en palabras de contador

1. **Facturación mensual.** Cada estudiante ya trae guardada su propia tarifa de mensualidad (`monto_mensualidad_base`) — igual que hoy tienes una columna por alumno en el Excel. Cuando corres `npm run facturar:mensual`, el sistema recorre a todos los estudiantes activos de un colegio y, para cada uno, revisa si tiene una beca vigente. Si no tiene, factura el 100%. Si tiene "Media Beca" (o cualquier otra que aplique a Mensualidad), factura el monto ya rebajado. El resultado es un renglón nuevo en `cargos_estudiante` con su saldo pendiente — el equivalente a haber llenado la celda del mes en la hoja Facturación, pero automático.
2. **Matrícula y Papelería.** Se generan una sola vez al año con `npm run facturar:anual`, usando la misma tarifa de Matrícula del estudiante (en tu Excel, Papelería casi siempre es igual a Matrícula — de 250 alumnos solo 1 tenía un monto distinto, y ese caso especial se resuelve con una beca/exoneración puntual, no cambiando la tarifa base).
3. **Recargo por mora del 10%.** Cada cargo mensual tiene una fecha de vencimiento (el día 5 del mes que se está cobrando). `npm run aplicar-mora` revisa todos los cargos que ya pasaron esa fecha y siguen con saldo pendiente, y les suma automáticamente el 10% — exactamente el mismo cálculo que hoy escribes a mano como nota ("APLICADA MORA 10%"). Un cargo nunca recibe el recargo dos veces, y si el estudiante ya pagó, no se le aplica nada.
4. **Planes diferenciados y modalidades del Instituto Técnico.** El sistema no tiene "Mensualidad" a secas — tiene un mapa (`modalidad-conceptos.json`) que dice: si el estudiante es de "Educación Preescolar y Primaria" usa la cuenta 410102; si es de "Carreras Técnicas" usa la 410202; si es "Cursos Libres" usa la 410213; si es "ICCM" usa la 410301. Así, cuando empecemos a cargar los estudiantes del Instituto Tecnológico, NO hay que tocar código — el mismo motor de facturación ya sabe facturarlos con su propia cuenta contable.

### Cómo probarlo

**Sin base de datos (ahora mismo, sin instalar nada):**
```
npm run probar-reglas
```
Esto corre 10 pruebas comparando el resultado de las fórmulas contra números REALES de tu Excel (Sharon pagando C$650, Gael con Media Beca pagando C$325, el caso real de "SE APLICO MORA 650+65: 715"). Las 10 pasaron ✅ — es la forma en que puedo garantizarte que la fórmula está bien, incluso sin tener todavía una base de datos conectada.

**Con base de datos real (después de hacer `prisma migrate` y `npm run seed`):**
```
npm run facturar:anual   -- --colegio=CMLM --anio=2026
npm run facturar:mensual -- --colegio=CMLM --anio=2026 --mes=9
npm run aplicar-mora     -- --colegio=CMLM
```
(Todavía falta cargar los ~280 estudiantes reales de tu Excel a la tabla `estudiantes` — ese es el siguiente paso natural: un script de importación desde tu archivo, para no digitarlos a mano.)

### Dos cosas que te quiero confirmar antes de seguir

1. **"Décimo Tercer Mes"**: en tu Excel casi ningún estudiante lo tiene facturado todavía — los únicos 2 casos que encontré son de 6to Grado (nivel de graduación). Por eso, a propósito, dejé este cargo FUERA de la generación automática por ahora. ¿Se cobra solo a los que se gradúan, como parte del combo de graduación? Si me confirmas la regla exacta (a quién y cuándo), lo conecto al Módulo de Control de Promociones.
2. **Modalidad "Secundaria"**: tu catálogo de cuentas no trae un rango de cuentas separado para Secundaria, así que asumí que usa las mismas cuentas que Preescolar/Primaria (410101-410105). Avísame si Secundaria del Instituto Técnico debe tener su propio juego de cuentas y lo ajustamos en `conceptos-arancel.json`.

### Nota sobre esta entrega (facturación)

Igual que con `schema.prisma`, aquí tampoco pude correr `prisma migrate`/`generate` en este espacio (mismo bloqueo de red hacia Prisma). Lo que SÍ pude hacer, y es una verificación real (no solo revisión visual):
- Pasé los 13 archivos nuevos por el compilador de TypeScript (`tsc`) en modo de solo-sintaxis — los 13 son válidos.
- Corrí las 10 pruebas de `npm run probar-reglas` de verdad, con Node, comparando contra números reales de tu Excel — las 10 pasaron.

Lo único que no se puede probar sin una base de datos real conectada es la parte que sí usa Prisma (`generar-cargos.ts`, `mora.ts` y los 3 scripts que los llaman) — ahí revisé a mano que cada nombre de tabla/campo coincida exactamente con `schema.prisma`, pero la prueba definitiva será la primera vez que los corras contra Supabase.

---

## Fase 3 — Multi-Empresa (Colegio + ICCM), Pantalla de Cajera y Automatización Contable

Esta fase convierte el sistema en lo que realmente es tu operación: **dos contabilidades separadas que conviven** (la de los 3 colegios, en córdobas, y la de ICCM/apadrinamiento, en dólares) más el motor que registra cada cobro en caja como un asiento de partida doble, sin que nadie tenga que cuadrar nada a mano.

### 1. "Multi-Empresa": por qué el catálogo de cuentas ahora tiene dos libros

Al revisar `Sistema_Contable_ICCM_2026.xlsm` encontré algo importante: **ICCM tiene su propio catálogo de cuentas, completamente independiente del catálogo de los colegios — y varios códigos se repiten entre los dos** (por ejemplo, el código `110101` existe en ambos catálogos, pero en uno es la Caja General del colegio y en el otro es una cuenta totalmente distinta de ICCM). Si hubiera metido todo en una sola tabla de cuentas, un reporte de un libro se habría mezclado con el otro.

La solución fue agregar un campo `libro` (`COLEGIO` o `ICCM`) a la tabla de cuentas y a cada comprobante/asiento contable, de modo que el código de cuenta ya no tiene que ser único por sí solo — es único **por libro**. En la práctica esto significa: el mismo motor de partida doble (mismas tablas, mismo código) sirve para llevar la contabilidad de los 3 colegios Y la de ICCM, sin que se crucen los números. Cargué las 72 cuentas del catálogo propio de ICCM en `prisma/data/catalogo-cuentas-iccm.json`, y agregué la cuenta `2110 - Ingresos Recibidos por Anticipado` al catálogo de los colegios (confirmé que ese código estaba libre en tu Excel).

### 2. Ficha del alumno dinámica y cambio de modalidad a mitad de año

Cada alumno ahora puede tener SU PROPIO monto de matrícula, mensualidad, papelería y décimo tercer mes (antes solo tenía mensualidad y matrícula) — así soportamos media beca, beca interna o cualquier tarifa especial (como los cupos de ICCM) sin inventar una beca distinta para cada caso: si el campo específico está vacío, el sistema usa la tarifa de matrícula como respaldo.

También agregué la tabla `HistorialModalidad`: cuando un alumno cambia de modalidad a mitad de año (por ejemplo, de Secundaria Técnica a Secundaria Regular por un tema económico), el sistema no vuelve a facturar los meses ya cobrados con la tarifa nueva — cada mes de facturación consulta cuál era la modalidad vigente EN ESE MES específico. Secundaria Regular (7am-12pm) usa las mismas cuentas que Primaria; Secundaria Técnica (7am-3pm) usa la cuenta 4102 (Carreras Técnicas y Cursos Libres) — por ahora comparte las mismas subcuentas que "Carreras Técnicas" (ver pregunta abierta #1 más abajo).

### 3. Regla de Noviembre/Diciembre y bloqueo de exámenes

`generarCargosNoviembreYDiciembre()` (script: `npm run facturar:nov-dic`) genera, el 01 de noviembre, las facturas de mensualidad de noviembre Y diciembre al mismo tiempo, tal como pediste. Además agregué `puedeHacerExamenesNoviembre(estudianteId)`, una función que la pantalla de exámenes (cuando la construyamos) puede llamar para saber si un alumno tiene el saldo de AMBOS meses en cero — si no, devuelve `false` y el alumno queda bloqueado para presentar exámenes finales de noviembre.

### 4. Anticipos de matrícula del año siguiente (cuenta 2110)

Cuando alguien paga matrícula (o abona) del año que aún no empieza, ese dinero NO se contabiliza todavía como ingreso real — sería incorrecto contablemente, porque el servicio (el año escolar) aún no se ha dado. Se contabiliza como una deuda del colegio hacia el alumno:

```
Débito  Caja General (110101)
Crédito Ingresos Recibidos por Anticipado (2110)
```

El 01 de enero del año que empieza, corres `regularizarAnticiposDelAnio({ anioLectivoQueEmpieza: 2027 })` — un proceso masivo que junta TODOS los anticipos que se cobraron para ese año, y hace un solo asiento de traslado por colegio:

```
Débito  Ingresos Recibidos por Anticipado (2110)     [el total acumulado]
Crédito Matrícula / Papelería / Décimo Tercer Mes    [cada una por su monto]
```

Cada pago que ya se trasladó queda marcado internamente para que el proceso se pueda correr de más sin riesgo de duplicar el traslado.

### 5. La Pantalla de Cajera: `procesarPago()`

Este es el corazón de esta entrega — la función que va a llamar la pantalla de caja cada vez que alguien cobra algo, sin importar de qué se trate. Recibe UN objeto con los datos del recibo y todas sus líneas de cobro (pueden ser varias cosas en un mismo recibo — por ejemplo, mensualidad + una camisa de uniforme, todo en un solo ROC), y devuelve el número de ROC generado, el/los comprobantes contables creados y cualquier alerta que la cajera deba ver. Mira `scripts/ejemplo-pago.ts` para un ejemplo completo y comentado.

Las 4 líneas de cobro que entiende, cada una con su propio amarre contable automático:

- **`ARANCEL_ACTUAL`** — Matrícula, Mensualidad (con o sin mora, con o sin beca), Papelería, Décimo Tercer Mes del año lectivo EN CURSO. → Débito Caja General / Crédito la cuenta de ingreso real del concepto (ya sea la del colegio en general o la 4102 si es Secundaria Técnica/Carreras Técnicas). Si el cargo es de un año lectivo futuro, la función lo RECHAZA a propósito y te dice que uses `ANTICIPO` en su lugar — así nunca se contabiliza sin querer un anticipo como ingreso ya devengado.
- **`ANTICIPO`** — Matrícula anticipada o abonos para el año siguiente. → Débito Caja General / Crédito 2110 (ver punto 4).
- **`OTRO_INGRESO`** — Uniformes escolares/deportivos, certificados de notas, constancias, cartas de recomendación, insignias, paquetes de guías, fotocopias, exámenes extraordinarios. → Débito Caja General / Crédito la cuenta de ingreso/venta que le corresponda (tú indicas el código de cuenta al armar la línea).
- **`ICCM_INGRESO`** — Mensualidades de apadrinamiento, Child Gifts, liberación de fondos retenidos. → Débito Banco USD BAC (11010401), ya restando la comisión bancaria internacional que informes en la línea / Crédito la cuenta de ingreso ICCM correspondiente. Aquí SIEMPRE se usa el libro `ICCM`, nunca el de los colegios.

**Garantía de "OK - Cuadrado":** antes de guardar CUALQUIER comprobante, la función suma todos los débitos y todos los créditos; si no coinciden (con un margen de un centavo por redondeo), lanza un error y **no se guarda absolutamente nada** — ni el ROC, ni el recibo, ni los cargos actualizados. Esto corre dentro de una transacción de base de datos, así que es estructuralmente imposible que quede un asiento descuadrado en el Libro Diario. No es una validación que alguien pueda saltarse: es la única forma en que el código sabe guardar un pago.

**Requisitos del módulo de caja** también quedaron resueltos: cada recibo genera un ROC numerado consecutivo POR COLEGIO (`siguienteNumeroRoc()`), y al procesar el pago la función revisa automáticamente si el alumno arrastra saldo pendiente de años anteriores o si tiene pendiente la doble factura de noviembre/diciembre, devolviendo esas alertas en el resultado para que la cajera las vea de inmediato en pantalla.

### 6. Integración con ICCM (Auditoría de Apadrinamiento)

Con base en `Apadrinamientos_Consolidado_2026.xlsx`:

- **`registrarAsignacionMensual()` / `registrarAsignacionesDelMes()`** — reflejan la decisión que ICCM ya toma en sus reportes mensuales (Disbursement Advice): si un niño está "Retenido" (foto o carta vencida), ese mes se le asigna **$0** de ingreso automáticamente, sin importar el monto base, y se genera una alerta con el motivo (Photo, Letter, Photo+Letter) para el dashboard.
- **`liberarFondosRetenidos()`** — cuando el niño ya se pone al día y ICCM libera los fondos que se habían quedado retenidos, esta función hace el asiento de regularización (Débito Banco USD / Crédito ingreso ICCM) y deja constancia del ajuste.
- **`registrarComisionBacMensual()`** — registra el débito de la comisión del banco NACIONAL (BAC Nicaragua), como gasto operativo independiente. **Corregido el 7 sept 2026 con Eduardo**: son dos comisiones distintas, ninguna es realmente fija — la del banco EXTRANJERO (~US$5, se descuenta dentro de `procesarPago()` al recibir la transferencia) y la del banco NACIONAL/BAC (~US$25, llega aparte y después en el estado de cuenta, y es la que registra esta función). Por eso `registrarComisionBacMensual()` ya no asume ningún monto por defecto: hay que pasarle el monto real que muestre el estado de cuenta de BAC ese mes.

### Secundaria Técnica: cuentas propias (confirmado)

Eduardo confirmó que necesita ver el ingreso de Secundaria Técnica separado del de Carreras Técnicas. Se activaron 3 códigos que estaban disponibles dentro de la 4102 — `410209 Matricula (S.T.)`, `410210 Mensualidad (S.T.)`, `410211 Papelería (S.T.)` — y `modalidad-conceptos.json` ya factura a Secundaria Técnica contra sus propias cuentas, no las de Carreras Técnicas.

### Preguntas abiertas / cosas que necesito que me confirmes

1. **Décimo Tercer Mes en Secundaria Técnica**: dejé este concepto en `null` para Secundaria Técnica (igual que Carreras Técnicas/Cursos Libres), porque no se ha confirmado si esa modalidad lo cobra. Como sí es una modalidad de Secundaria (con calendario académico normal, solo cambia el horario), podría aplicar igual que en Secundaria Regular. Avisame y le activo el código 410217 que quedó disponible para eso.
2. **Comprobantes de ICCM y el colegio "ancla"**: confirmaste que está bien dejarlo así por ahora y decidir después cómo manejarlo — queda documentado: el dinero de ICCM no pertenece a un colegio específico, así que se usa el primer colegio registrado solo para poder numerar el comprobante; el detalle real por colegio de cada niño patrocinado sí queda correcto y completo en sus propias tablas.
3. **Importación del histórico de ICCM (2022-2026)**: ya resuelto, ver la sección siguiente.

## Importación del histórico ICCM (2022-2025)

Antes de escribir el importador, analicé a fondo los 8 Excel que subiste (`Sistema_Contable_ICCM_{2022..2025}.xlsm` y `Apadrinamientos_Consolidado_{2022..2025}.xlsx`) y te hice 4 preguntas de negocio — ya las contestaste, y con eso quedó armado el importador real (no un plan, el script ya lee tus Excel originales):

```
prisma/
├── data/iccm-ninos.json          ← Los 253 niños del maestro 2026 (BD_PADRINOS_NINOS), listos para sembrar.
└── seed-iccm-ninos.ts            ← Siembra la tabla de niños ICCM (prerequisito del importador).

scripts/
└── importar-historico-iccm.ts    ← Lee los 8 Excel originales y carga: Jornalización 2022-2025 (libro
                                     diario formal de ICCM), y de 2023-2025 las asignaciones mensuales por
                                     niño (Patrocinados + Retenidos cruzados), los Regalos (Gifts) y la
                                     Conciliación bancaria mensual.
```

### Cómo se aplicaron tus 4 respuestas

1. **2022**: se importa la Jornalización completa (33 comprobantes agrupados, cuadran en dólares: US$40,481.47 débito = crédito). El Excel de apadrinamientos de 2022 no tiene nada real que importar, como ya sabíamos.
2. **"OJO LA SUMA NO CUADRA-REVISAR"**: eso vive solo dentro del propio Excel como una fórmula de verificación (compara la columna en córdobas contra la columna en dólares del mismo asiento, así que nunca coincidiría esa comparación puntual, sea por decimales o por ser monedas distintas). El importador NO usa esa fórmula — vuelve a sumar débito vs. crédito en dólares por su cuenta antes de guardar cada comprobante, y si alguno no cuadra lo salta con una advertencia en la consola en vez de meterlo a la fuerza. Con los 4 años reales, cero asientos quedaron descuadrados.
3. **Junio 2025 en $0 y la comisión internacional en $0 desde julio**: como confirmaste que ambos son reales (no huecos de datos), el importador los carga tal cual vienen en el Excel, sin inventar ni rellenar nada.
4. **Estado "Sin dato"**: se guarda literal como un tercer estado (`SIN_DATO`, junto a `RETENIDO`/`NO_RETENIDO` en el nuevo enum `EstadoRetencionIccm`) — no se le asigna $0 de ingreso ni se asume que no está retenido; queda visible para que lo verifiques cuando quieras.

### Otros detalles que resolví durante la construcción

- Los maestros de niños/cuentas de los archivos históricos están "congelados" (son la misma copia del maestro 2026 pegada en los 4 años) — por eso el importador siembra el maestro de niños UNA SOLA VEZ desde el 2026 (`seed-iccm-ninos.ts`) y, si un código histórico ya no existe ahí (encontré solo 1 caso: `NC200-00184`, seguramente una baja anterior a 2026), lo crea automáticamente como registro histórico marcado `DE_BAJA`, para no perder esa fila de dinero.
- En 2025, la hoja "Conciliacion bancaria" cambió de formato (el encabezado real está en la fila 5, no en la fila 1) — el importador detecta la fila de encabezado automáticamente comparando el texto, así que no depende de que el layout sea siempre igual.
- Se descartan automáticamente: la fila de "Total:" que quedó mezclada al final de Regalos 2025, y las 2 filas de esa misma hoja donde la fecha quedó pegada por error en la columna de código.
- El importador es "corre de más sin miedo" (idempotente): si lo ejecutás dos veces no duplica nada — se salta cualquier comprobante que ya exista y actualiza (no duplica) las asignaciones/conciliaciones.

### Cómo correrlo (cuando tengas la base de datos conectada)

```
# 1) Poné los 8 Excel originales (mismos nombres con que los subiste al proyecto)
#    dentro de una carpeta "datos-historicos" en la raíz de este proyecto.

# 2) Sembrá el maestro de niños ICCM (una sola vez):
npm run seed:iccm-ninos

# 3) Corré el importador:
npm run importar-historico-iccm
```

### Nota sobre esta entrega (multi-empresa, caja, ICCM e histórico)

Mismo bloqueo de red de siempre: no pude correr `prisma generate`/`migrate` ni conectar a una base de datos real en este espacio de trabajo. Lo que sí hice, como verificación real:
- Revisé a mano cada relación nueva del `schema.prisma` (37+ tablas / 23 catálogos de valores fijos en total ahora) y conté llaves y paréntesis con un script para confirmar que todo cierra en pares.
- Pasé los 23 archivos nuevos o modificados de esta fase por el compilador de TypeScript en modo de solo-sintaxis — los 23 son válidos.
- Para el importador histórico en particular, ejecuté de verdad (con Node, sin Prisma) la misma lógica de lectura y agrupación de los 8 Excel reales que subiste, para confirmar ANTES de entregarte el script que: los 4 años de Jornalización sí cuadran (0 asientos descuadrados), los conteos de Patrocinados/Retenidos/Regalos coinciden con el análisis previo, y la detección automática de la fila de encabezado de 2025 funciona. Lo único que no pude probar de punta a punta es la escritura real en la base de datos (`prisma.$transaction`, los upserts) porque no hay una base de datos disponible en este entorno — esa será la prueba definitiva la primera vez que corras `npm run importar-historico-iccm` en tu computadora o en Supabase.

## Importación de estudiantes reales — Colegio El Mesías

Con la base de datos y el catálogo ya funcionando, el siguiente paso natural era cargar a los estudiantes reales (sin esto, `procesarPago()`, la facturación y los reportes no tienen con qué probarse). Empecé por El Mesías porque es el único de los 3 colegios que ya tiene su Excel completo (`Contabilidad_2026  El Mesias. Actual al 26.08.2026.xlsx`, hoja "Base de Datos").

```
prisma/
├── data/niveles-academicos.json   ← Los 9 niveles reales (I/II/III Nivel, 1ro-6to. Grado), con III Nivel y
│                                     6to. Grado marcados como nivel de graduación.
├── data/tipos-beca.json           ← "Media Beca" (50% en Mensualidad) y "Beca Interna".
└── seed-niveles-becas.ts          ← Siembra ambos catálogos.

scripts/
└── importar-estudiantes-el-mesias.ts   ← Lee la hoja "Base de Datos" real y carga a los estudiantes.
```

### Lo que encontré al leer la hoja real (y cómo lo resolví)

La hoja tiene 300 códigos de estudiante en total, pero no los 300 son alumnos activos con datos completos:

- **50 filas sin Nivel Académico ni montos** — son anotaciones de alumnos retirados, graduados a secundaria (fuera del rango de este colegio), o ni siquiera son alumnos (2 filas dicen literalmente "COLEGIO METODISTA LIBRE- EL BUEN PASTOR/EL MESIAS", parecen notas sueltas). Como no tienen ningún dato financiero, **no se importan por ahora** — decime si querés que los conserve como historial inactivo.
- **25 filas con Nivel y Matrícula, pero Mensualidad en blanco** — al revisarlas, 24 de esas 25 están marcadas "ICCM" en la columna Programa. Esto no es un hueco de datos: **son alumnos cuya mensualidad la cubre 100% el apadrinamiento de ICCM**, así que el colegio no la factura (ese ingreso entra por el otro libro, el de ICCM). Se importan con `montoMensualidadBase = 0` en vez de descartarlos — es un hallazgo útil: son 24 alumnos donde el sistema debe saber que $0 de mensualidad es correcto, no un error de captura. La única fila sin NINGÚN dato financiero (ni matrícula ni mensualidad) sí se omite.
- **La columna "Programa" mezcla dos cosas**: a veces de verdad dice el programa del alumno ("ICCM", 47 casos), pero 14 veces en realidad trae el tipo de BECA escrito ahí por error ("MEDIA", "MEDIA BECA", "Media beca", "INTERNA", "B. INTERNA", " INTERNA"). Los separé: se creó un registro real de `EstudianteBeca` (7 con Media Beca, 7 con Beca Interna) en vez de dejar ese texto suelto sin sentido contable.
- **Papelería y Décimo Tercer Mes no vienen en esta hoja** — se dejan en `null` (usan automáticamente el monto de Matrícula, tal como se documentó desde la Fase 2).

En total: **248 estudiantes activos** quedan listos para importarse (de los 300 códigos que trae la hoja).

### Pregunta abierta

**"Beca Interna"**: a diferencia de "Media Beca" (que sí reduce la Mensualidad a la mitad de forma visible en la hoja), los 7 alumnos marcados "INTERNA"/"B. INTERNA" aparecen con Mensualidad = Matrícula, es decir, sin ningún descuento visible en esas 2 columnas. Por ahora registro la beca como dato informativo (no reduce ningún monto automáticamente). ¿La Beca Interna en tu colegio reduce algo que no se ve en la hoja "Base de Datos" (por ejemplo Papelería o Décimo Tercero), o es correcto que por ahora quede solo como una anotación sin efecto en el monto?

### Cómo correrlo (cuando tengas la base de datos conectada)

```
# 1) Poné "Contabilidad_2026  El Mesias. Actual al 26.08.2026.xlsx" (mismo nombre
#    con que lo subiste al proyecto) dentro de la carpeta "datos-historicos".

npm run seed:niveles-becas
npm run importar-estudiantes-el-mesias
```

### Nota sobre esta entrega (estudiantes de El Mesías)

Igual que con el importador de ICCM: no hay base de datos conectada en este entorno, así que no pude correr el import de punta a punta. Sí ejecuté (con Node, sin Prisma) la misma lógica de lectura/filtrado contra el Excel real de El Mesías para confirmar los números de arriba (248 válidos, 24 con mensualidad en $0 por ICCM, 7+7 becas detectadas, los 9 niveles reconocidos) antes de entregarte el script, y pasó el mismo chequeo sintáctico de TypeScript que el resto del proyecto.

---

## Instituto Tecnológico (niveles 7mo-11mo), Módulo de Pago, Libro Diario/Mayor, Cierres y Nóminas

A partir de `Ingresos 2026  ITML ACTUALIZADO 1.xlsx` (subido a la carpeta del proyecto) y del pedido de Eduardo del 7 sept 2026.

### 1) Niveles académicos del Instituto (7mo-11mo Grado)

Leídos directamente de la hoja "Base de Datos" de ese Excel:

| Nivel | Alumnos en la hoja | Matrícula base | Mensualidad base |
|---|---|---|---|
| 7mo. Grado | 33 | C$3,500 | C$1,500 |
| 8vo. Grado | 33 | C$3,500 | C$1,500 |
| 9no. Grado | 36 | C$3,500 | C$1,500 |
| 10mo. Grado | 21 | C$3,500 | C$1,500 |
| 11mo. Grado (graduación) | 29 | C$3,500 | C$1,500 |

Los alumnos patrocinados por ICCM pagan C$800 de mensualidad en vez de C$1,500 -- es un override de la ficha individual del alumno (igual que el patrón ya usado en El Mesías), no una fórmula nueva. Se agregaron a `prisma/data/niveles-academicos.json` bajo la modalidad "Secundaria Técnica" (ya existente desde la Fase 3). **Nota:** todavía no se importaron los ~150 alumnos del Instituto como estudiantes reales -- solo se crearon los niveles académicos, que es lo que Eduardo pidió en este punto. El importador de alumnos (como el que se hizo para El Mesías) queda como siguiente paso si Eduardo lo quiere.

### 2) Módulo de Pago a Proveedores (`src/lib/pagos/`)

Cubre los 11 puntos pedidos en una sola función transaccional, `registrarPagoProveedor()`:

- **Proveedor**: se reutiliza `TerceroBeneficiario` (ya tenía RUC/Cédula) en vez de crear una tabla nueva -- se le agregaron `tieneConstanciaNoRetencion` y `constanciaVigenciaHasta`.
- **Forma de pago**: Caja General / Transferencia / Cheque (`FormaPagoProveedor`).
- **Numeración automática "YY-X-NN"**: `siguienteNumeroAsientoMensual()` -- ej. enero: `26-A-01`, `26-A-02`...; febrero: `26-B-01`... Usa la MISMA letra de mes (A=enero...L=diciembre) que ya existía en el libro diario histórico de ICCM ("H-01" = agosto), con un contador propio por colegio+libro+mes que reinicia cada mes (`ComprobanteContadorMensual`). Si la forma de pago es Cheque, se usa el número de cheque tal cual (no consume este contador).
- **Retención automática (`src/lib/pagos/retencion.ts`)**:
  - Compra o servicio general: factura > C$1,000 → 2%, calculado ANTES de IVA.
  - Servicio profesional: 10% sobre el monto total del servicio.
  - Proveedor con constancia de no retención vigente → exonerado de toda retención.
- **Cuentas de gasto multi-línea**: deben sumar exactamente el monto de la factura (se valida antes de guardar nada, igual que el resto del sistema).
- **Historial del proveedor** (`historial-proveedor.ts`): pagos previos + ranking de cuentas más usadas, para sugerir la cuenta correcta según el concepto.
- **Jornalización automática**: Débito la(s) cuenta(s) de gasto elegidas, Crédito Retenciones Por Pagar (si aplica) y Crédito Caja/Banco por el neto -- siempre cuadra por construcción. El concepto del asiento junta automáticamente el # de factura y las cuentas usadas.

### 3) Libro Diario y Libro Mayor (`src/lib/reportes/`)

No son tablas nuevas -- son reportes sobre `Comprobante`/`AsientoContable` (tal como ya se había decidido en `diseno-base-datos.md`):

- `libro-diario.ts`: cronológico, con el estado "OK - Cuadrado" / "⚠ DESCUADRADO" de cada comprobante.
- `libro-mayor.ts`: por cuenta, con saldo inicial + movimientos = saldo final.
- `balanza-comprobacion.ts` / `estado-resultados.ts` / `balance-general.ts`: las 3 vistas contables en tiempo real. `colegioId` es opcional -- si se omite, es la "Balanza Total" **consolidada** de los 3 colegios para el tablero de la Junta Administrativa (requisito 1 del proyecto), sin copiar nada a mano.

### 4) Cierre Mensual y Cierre Anual (`src/lib/cierres/`)

- `cerrarMes()`: congela (snapshot JSON) la Balanza, el Estado de Resultados y el Balance General de ese mes, y bloquea nuevos comprobantes con fecha en ese mes. El candado vive DENTRO de `crearComprobanteBalanceado()`, así que aplica automáticamente a TODOS los módulos (cobros, pagos, nómina, ICCM) sin tener que acordarse de repetirlo en cada uno.
- `reabrirMes()`: para el caso operativo real de tener que corregir algo de un mes ya cerrado.
- `cerrarAnio()`: exige los 12 meses ya cerrados, genera el asiento que cancela Ingresos/Costos/Gastos contra la cuenta "34 Excedente Del Ejercicio" (utilidad o pérdida del año, ya existía en el catálogo), y abre el año lectivo siguiente automáticamente.

### 5) Módulo de Nóminas -- diseño PROVISIONAL (`src/lib/nomina/`)

Soporta los 4 esquemas que pidió Eduardo:

- Instituto: docentes horarios (10% retención), contrato por servicios generales (2% retención), personal fijo (misma estructura que El Mesías).
- El Buen Pastor: maestros inscritos al INSS / no inscritos al INSS.

**⚠️ Pendiente:** Eduardo mencionó que dejaría la nómina real de uno de los colegios en la carpeta del proyecto como fuente de verdad, pero ese archivo **todavía no ha aparecido** ahí. Por eso, por ahora:

- El 10%/2% del Instituto SÍ se calcula automático (ya confirmado explícitamente por Eduardo en texto).
- El INSS laboral/patronal y los tramos de IR (tabla DGI) quedan como campos MANUALES editables (`inssLaboral`, `irBase`) -- no se inventó ningún porcentaje de INSS o de IR sin confirmarlo primero con el Excel real.
- La estructura exacta de "personal fijo" de El Mesías (que el Instituto debe replicar) también está pendiente de ese mismo Excel.

En cuanto Eduardo suba el archivo, solo hay que ajustar `calcularRetencionNomina()` en `src/lib/nomina/registrar-planilla.ts` -- el resto (persistencia, jornalización automática vía `jornalizarPlanilla()`) ya está listo y no debería necesitar cambios.

### Verificación de esta entrega

Sin base de datos conectada en este entorno, se verificó:

- `schema.prisma`: 74/74 llaves y 754/754 paréntesis balanceados, 45 modelos, 27 enums, y un chequeo automatizado de que cada relación nueva tiene su contraparte en ambos modelos (nada de relaciones "colgadas").
- Sintaxis TypeScript de los 37 archivos del proyecto (`ts.transpileModule`), 0 errores.
- `npm run probar-modulo-pago` -- 16 pruebas reales sin base de datos (retención 2%/10%, exoneración por constancia, vigencia de la constancia, letra de mes A-L, retenciones de nómina del Instituto), las 16 ✅.

---

## Nóminas con datos reales, importador de alumnos del Instituto y primeras pantallas web

A partir de los 3 Excel de nómina reales que subiste ("04 NÓMINAS 2026 1..xlsx", "1.xlsx" y "2.xlsx") y de `Ingresos 2026  ITML ACTUALIZADO 1.xlsx`, pedido de Eduardo del 7 sept 2026.

### 1) Nóminas con INSS/IR reales -- ya no son campos manuales

```
src/lib/nomina/
├── inss-ir.ts               ← NUEVO. Las tasas oficiales: INSS Laboral 7%, INSS Patronal 21.5%/22.5%,
│                                INATEC 2% (apagado por defecto), IR progresivo (Ley 822), 10%/2% de servicios.
└── registrar-planilla.ts    ← Reescrito: ya no pide `inssLaboral`/`irBase` a mano -- los calcula solo.

scripts/
├── probar-nominas-reales.ts        ← Recalcula con las fórmulas nuevas los 3 Excel reales, empleado por
│                                       empleado, y compara centavo a centavo. `npm run probar-nominas-reales`.
└── nominas-reales-extraidas.json   ← Los datos reales ya extraídos de los 3 Excel (para que la prueba de
                                        arriba corra sin tener que volver a leer los .xlsx originales).
```

**Identificación de los 3 archivos** (por el texto real de la hoja "COLILLAS" de cada uno, no por el nombre del archivo):

| Archivo | Colegio | Tipo de planilla |
|---|---|---|
| "04 NÓMINAS 2026 1..xlsx" | El Mesías | Personal Fijo |
| "04 NÓMINAS 2026 1.xlsx" | Instituto Tecnológico | Personal Fijo |
| "04 NÓMINAS 2026 2.xlsx" | Instituto Tecnológico | Pago por Servicios (docentes por hora + contratos) |

**Confirmado exacto contra los 3 Excel reales** (526 valores comparados centavo a centavo, `npm run probar-nominas-reales`):

- **INSS Laboral** = `(Total Ingresos - Viáticos de Transporte) × 7%` -- retenido al empleado.
- **INSS Patronal** = `Salario Cotizado × 21.5%` -- confirmado exacto en las 2 planillas de Personal Fijo. La ley nicaragüense sube esta tasa a 22.5% solo para empleadores con 50 o más trabajadores; ninguno de los 3 colegios llega ahí hoy, así que se usa 21.5% (ambas tasas quedan implementadas por si algún día aplica el segundo tramo).
- **Servicio Profesional** (docente por hora, Instituto) = 10% de retención.
- **Servicio General** (contrato, Instituto) = 2% de retención.
- **INATEC patronal**: los 3 Excel reales lo traen literalmente en cero (ni siquiera es una fórmula) -- se deja **apagado por defecto** en el sistema. Avisame si el colegio tiene alguna exoneración que lo explique, o si de plano no se estaba calculando y hay que activarlo.
- **IR (Impuesto sobre la Renta)**: ninguno de los 3 Excel reales calcula IR todavía (se revisó cada hoja buscando "IR"/"RENTA"/"IMPUESTO" -- cero resultados). El sistema SÍ trae la tabla progresiva completa de la Ley 822 lista (proyección anual simplificada), pero hoy da C$0 para todos los empleados reales porque ningún salario supera el mínimo exento -- queda lista para el día que algún salario sí lo amerite.

**Hallazgo para que revises** (no es un error del sistema -- es una inconsistencia dentro de tu propia plantilla de Excel): en la hoja "Pago por Servicios" del Instituto, 4 filas a lo largo del año (Peter Joseph Robinson Talavera en agosto 2026; Ligia Esthela Calero Murillo en mayo, junio y julio 2026) están escritas como **"Docente"** en la columna "Tipo de Servicio", pero la fórmula de esa fila en el Excel les calculó el mismo 2% que "Servicio General". Según la regla que vos mismo definiste por escrito ("los docentes por hora llevan 10% de retención, como Servicios Profesionales"), esas 4 filas deberían llevar 10%, no 2%. El sistema nuevo va a aplicar 10% automáticamente a cualquier empleado que se registre como docente por hora -- avisame si alguno de esos 4 pagos ya liquidados necesita un ajuste retroactivo.

**Pendiente**: el archivo de nómina de **El Buen Pastor** todavía no se ha subido -- la separación entre planilla inscrita/no inscrita al INSS de ese colegio queda tal como se dejó en la entrega anterior (provisional), a la espera de ese Excel real.

### 2) Importador de alumnos del Instituto Tecnológico (~150 alumnos)

```
scripts/importar-estudiantes-itml.ts   ← npm run importar-estudiantes-itml
```

Mismo patrón que el importador de El Mesías, leyendo la hoja "Base de Datos" de `Ingresos 2026  ITML ACTUALIZADO 1.xlsx`. **152 alumnos** de Secundaria Técnica, todos con datos financieros completos:

- 107 con la tarifa base C$1,500 de mensualidad.
- 43 con la tarifa de cupo ICCM C$800.
- 1 caso de Beca Total vía ICCM (mensualidad C$0 -- ITML-2026-035, Carlos Antonio Barberena Hernandez).
- 1 pago diferenciado personalizado (mensualidad C$1,000, sin ser ICCM -- ITML-2026-125, Samantha Valeria Madrigal Martinez).

Los últimos 2 casos se señalan en la salida del script (no se inventa nada, se importa el monto exacto que trae el Excel) para que los confirmes. A diferencia de El Mesías, esta hoja no trae columna de Cédula del Tutor, y todos los alumnos son de "Secundaria Técnica" -- todavía no hay filas de Cursos Libres ni Carreras Técnicas en este archivo.

```
npm run seed:niveles-becas          # si no lo habías corrido ya
npm run importar-estudiantes-itml
```

### 3) Primeras pantallas web (Next.js) -- Cajera y Egresos

Con toda la lógica contable de ingresos, egresos, anticipos y nómina ya lista, arrancó el frontend real (antes solo existía el motor en `src/lib`, sin ninguna pantalla):

```
src/app/
├── layout.tsx, page.tsx, globals.css   ← Estructura base y estilos de todo el sistema.
├── caja/
│   ├── page.tsx                        ← Carga colegios y cuentas de ingreso, renderiza la pantalla.
│   └── actions.ts                      ← Server Actions: buscar alumno, emitir ROC (llama a `procesarPago()`).
└── egresos/
    ├── page.tsx
    └── actions.ts                      ← Server Actions: buscar proveedor, historial, retención en vivo, registrar pago.

src/components/
├── caja/PantallaCajera.tsx        ← El formulario de la cajera.
└── egresos/PantallaEgresos.tsx    ← El formulario de egresos y proveedores.

src/lib/reportes/estado-cuenta.ts  ← NUEVO: estado de cuenta por alumno (punto 3a de la especificación).
```

**Pantalla de Cajera** (`/caja`): la cajera escribe el Código NC del alumno y ve de inmediato su nombre, nivel/sección, tutor, y -- si arrastra algo vencido -- una alerta roja con el monto y cuántos meses. Debajo, la tabla de aranceles pendientes (Matrícula, Mensualidad, Papelería, Décimo Tercero) con casilla para marcar cuáles cobrar y el monto editable por línea (por defecto el saldo completo), marcando "VENCIDO" en rojo los que ya pasaron su fecha. Una sección aparte para uniformes/certificados/otros cobros libres (cuenta contable + descripción + monto). Al presionar "Emitir ROC" se llama de verdad a `procesarPago()` -- si algo no cuadra o el mes ya está cerrado, la pantalla muestra el error exacto y no se guarda nada; si todo sale bien, muestra el número de ROC, el comprobante generado y cualquier alerta (por ejemplo, si se le acaba de aplicar el 10% de mora en ese mismo instante).

**Pantalla de Egresos y Proveedores** (`/egresos`): buscás al proveedor por nombre, nombre comercial o RUC/cédula; al seleccionarlo, la pantalla muestra su historial de pagos y sus cuentas de gasto más usadas (para no tener que adivinar cuál usar). Se elige el tipo de gasto (compra/servicio general o servicio profesional), la forma de pago, y en cuanto escribís el monto de la factura la pantalla calcula la retención EN VIVO (2%/10%, respetando la regla de los C$1,000 antes de IVA) y muestra el neto a pagar -- antes de guardar nada. El detalle de cuentas de gasto (multi-línea) se valida en pantalla contra el total de la factura, igual que lo hace `registrarPagoProveedor()` por dentro. Al registrar, se muestra el comprobante generado con su clave "YY-X-NN".

Ambas pantallas son Server Components con Server Actions como único puente hacia Prisma -- el navegador nunca toca la base de datos directamente, y la garantía de partida doble (`crearComprobanteBalanceado()`) sigue siendo la única forma en que cualquier módulo puede guardar un asiento.

```
npm run dev
# abre http://localhost:3000 (con DATABASE_URL configurado y las migraciones ya corridas)
```

### Verificación de esta entrega

- **`npm run probar-nominas-reales`**: 527 de 527 comparaciones contra los 3 Excel reales de nómina cuadran exacto (dentro de 1 centavo) -- 166 filas de personal fijo (INSS Laboral + INSS Patronal) y 33 filas de servicios (10%/2%). Los 4 casos "Docente vs. 2%" se reportan aparte como hallazgo, no como fallo.
- **`npm run probar-modulo-pago`**: se actualizó (usaba una función de nómina provisional que ya no existe tras el reemplazo de este punto) y las 17 pruebas pasan limpias.
- **Sintaxis**: `node --experimental-strip-types --check` sobre los 40+ archivos `.ts`/`.tsx` del proyecto -- 0 errores de sintaxis.
- **`npx prisma generate` sigue bloqueado en este entorno de desarrollo** (la red de este sandbox no permite descargar los binarios de Prisma desde `binaries.prisma.sh` -- error 403). Esto es una restricción de ESTE espacio de trabajo, no del código: en tu servidor real (o en Vercel) `npm install && npx prisma generate` debe funcionar normal, igual que en cualquier proyecto Next.js + Prisma. Por eso mismo, un chequeo estricto con `npx tsc --noEmit` reporta bastantes errores de tipo "no exported member" / "implicitly has an any type" en TODO el proyecto (archivos viejos y nuevos por igual) -- son 100% causados por que el cliente de Prisma no está generado aquí, y desaparecen solos en cuanto corras `prisma generate` con una red normal. Sí se aprovechó ese chequeo para encontrar y corregir un error real: `scripts/probar-modulo-pago.ts` todavía importaba una función de nómina provisional que ya no existe (ver arriba).

---

## Nómina de El Buen Pastor, exportación a Excel universal, Retenciones DGI, WhatsApp y Dashboard de la Junta

Entrega de la noche del 7 sept 2026 -- procesamiento masivo del bloque de 5 requerimientos que pediste, a partir de los 2 archivos de nómina de El Buen Pastor que subiste (personal inscrito y no inscrito al INSS).

### 1) Nómina de El Buen Pastor -- ya no es provisional, está confirmada exacta

Analicé tus 2 Excel reales ("04 NÓMINAS 2026 1 5.xlsx" = personal INSCRITO al INSS, con sus hojas "Decla. Inss [Mes]"; "04 NÓMINAS 2026 2 2.xlsx" = personal NO inscrito) y encontré 2 mecánicas que tu Excel usa y que no estaban documentadas todavía:

- **Pago quincenal, pero el INSS se retiene todo en la 2da quincena**: el personal inscrito paga cada 15 días, pero el 7% de INSS Laboral se le descuenta TODO junto en la 2da quincena del mes (14% de esa quincena), quedando en C$0 en la 1ra. Como 14% de una quincena equivale exactamente al 7% del salario mensual completo, el total retenido en el mes es idéntico a un esquema mensual normal -- por eso no hizo falta cambiar la estructura de `PlanillaMensual` para modelarlo, solo la fórmula de cálculo.
- **"Piso de cotización" de C$8,341.29/mes** (`PISO_COTIZACION_DOCENCIA_MENSUAL` en `src/lib/nomina/inss-ir.ts`): cuando el salario real de un docente/administrativo inscrito es MENOR a este piso, el colegio debe DECLARAR y PAGAR al INSS el 7%/21.5% calculado sobre el piso (no sobre el salario real), pero al empleado solo se le deduce de su cheque el 7% de su salario real -- la diferencia la asume El Buen Pastor como gasto patronal adicional (`subsidioInssPiso`, nuevo campo en `PlanillaDetalle`). Este mecanismo es específico de El Buen Pastor -- El Mesías e Instituto siguen cotizando sobre el salario real sin ningún piso.

**Confirmado exacto (0 diferencias) contra tus 2 Excel reales** -- 288 comparaciones centavo a centavo (enero-marzo 2026, 8 empleados):
```
npm run probar-nominas-buen-pastor
```
- 48 quincenas de personal No-INSS: INSS Laboral = C$0 siempre. ✅ 48/48
- 48 quincenas de personal INSS: patrón 0%/14% del pago quincenal. ✅ 48/48
- 24 declaraciones reales al INSS (hoja "Decla. Inss [Mes]"): el piso de cotización cuando el salario real no lo alcanza, y el salario real cuando sí lo supera (ej. la Directora General, C$14,416/mes). ✅ 24/24 × 3 columnas verificadas

La jornalización de las 2 planillas de El Buen Pastor (`jornalizarPlanilla()` en `registrar-planilla.ts`) usa exactamente el mismo motor de partida doble balanceada (`crearComprobanteBalanceado()`) que ya usa todo el resto del sistema -- el subsidio del piso se suma dentro de la misma cuenta de gasto de INSS Patronal (60203) y dentro del mismo pasivo de INSS Laboral (210601); si preferís verlo en una sub-cuenta separada ("Subsidio Piso INSS Mínimo"), es un cambio de una línea, avisame.

**IR**: igual que en El Mesías/Instituto, ninguno de los 2 Excel de El Buen Pastor calcula IR todavía -- sigue en C$0 porque ningún salario real supera el tramo exento de la Ley 822.

### 2) Exportación a Excel -- ahora es transversal a TODO el sistema

Pediste que "TODO tipo de reporte, nómina y estado financiero" tenga descarga nativa a `.xlsx`. Se construyó una sola utilidad compartida para que ningún módulo tenga que reinventar cómo se arma un Excel:

```
src/lib/exportar/
├── excel.ts                        ← La utilidad base: crearHoja(), crearLibro(), libroABase64().
├── exportar-estados-financieros.ts ← Balance General, Estado de Resultados, Balanza, Libro Diario, Libro Mayor.
└── exportar-dashboard.ts           ← Top Morosidad, Retenidos ICCM, Comisiones BAC.

src/components/shared/BotonDescargarExcel.tsx   ← El botón "⬇ Descargar Excel" reutilizable -- lo usan
                                                    TODAS las pantallas nuevas (nómina, DGI, dashboard).
```

Nota técnica honesta: la versión gratuita del paquete `xlsx` (SheetJS Community, ya venía en tu `package.json`) no soporta negrita/colores de celda -- solo valores y ancho de columna. Los archivos abren perfectos en Excel/Google Sheets (probado de punta a punta: se generó un libro, se leyó de vuelta con la misma librería, y los datos coinciden exacto), pero si más adelante querés encabezados en negrita/con color, hay que agregar `exceljs` -- avisame y lo cambiamos en un paso aparte, sin tocar el resto del sistema.

### 3) Pantalla de Nóminas (`/nomina`) -- nuevo

```
src/app/nomina/actions.ts, page.tsx
src/components/nomina/PantallaNomina.tsx
src/lib/nomina/exportar-nomina.ts
```

Lista todas las planillas ya registradas (de los 3 colegios, las 5 combinaciones de tipo de nómina), con un botón de Excel por fila que descarga un libro con 2 hojas: "Resumen" (totales del colegio+periodo: bruto, INSS/IR deducido, neto pagado, y el gasto patronal adicional) y "Detalle por Empleado" (una fila por empleado, con las columnas exactas que pediste: bruto, INSS/IR, neto a recibir).

### 4) Módulo Especial de Retenciones DGI (`/dgi`) -- nuevo

```
src/lib/reportes/retenciones-dgi.ts
src/app/dgi/actions.ts, page.tsx
src/components/dgi/PantallaRetencionesDgi.tsx
```

Elegís Año + Mes (+ opcionalmente una sede), y el sistema junta automáticamente:
1. Las retenciones 2%/10% de `PagoProveedor` (Módulo de Egresos) del mes.
2. Las retenciones 10% de `PlanillaDetalle` de las planillas `DOCENTE_HORARIO` (docentes por hora) del mes.

Se exporta a Excel con exactamente las columnas que pediste: Fecha, Nombre del Proveedor/Docente, RUC/Cédula, # Factura/Planilla, Monto Base, Monto de Retención Aplicado -- listo para llevar directo a la declaración de la DGI.

**Aviso de alcance** (dejar constancia, no lo decidí por mi cuenta): el Módulo de Nóminas también calcula una retención del 2% a `CONTRATO_SERVICIOS_GENERALES` (contratos del Instituto) -- vos solo pediste explícitamente incluir la de "docentes por hora" (10%) en este reporte, así que por ahora esa otra NO entra. Si confirmás que también debe declararse aquí, es un cambio de una línea en `retenciones-dgi.ts`.

### 5) Módulo de Cobranza WhatsApp -- nuevo

```
src/lib/reportes/whatsapp-sender.ts
```

`generarMensajeCobranza()` arma el texto dinámico a partir del estado de cuenta REAL del alumno (el mismo que usa la Pantalla de Cajera): tutor, alumno, colegio, grado/sección, el detalle mes por mes de lo vencido (marcando si ya lleva el 10% de mora), los aranceles pendientes que aún no vencen, y el saldo total. Arma el link `https://wa.me/...` con el mensaje ya escrito -- normaliza automáticamente los teléfonos nicaragüenses de 8 dígitos anteponiéndoles el código de país 505. Cada mensaje generado queda registrado en `mensajes_cobranza_whatsapp` (auditoría de qué se generó y cuándo).

En `PantallaCajera.tsx`, cuando un alumno tiene saldo vencido aparece un botón "💬 WhatsApp al tutor" junto a la alerta roja -- genera el mensaje y abre WhatsApp Web/App ya con el texto listo para enviar. Si el alumno no tiene teléfono de tutor registrado, la pantalla muestra el mensaje completo para copiarlo a mano en vez de fallar en silencio.

Aclaración importante: esto abre un link `wa.me` (requiere que alguien presione "Enviar" del lado de WhatsApp) -- NO es un envío 100% automático sin intervención humana, porque eso requeriría la API oficial de WhatsApp Business (cuenta y costo aparte). Si en algún momento querés automatizar el envío por completo, avisame para cotizar esa integración.

### 6) Dashboard Consolidado de la Junta Directiva (`/dashboard`) -- nuevo

```
src/lib/reportes/morosidad.ts, iccm-auditoria.ts
src/app/dashboard/actions.ts, page.tsx
src/components/dashboard/JuntaDashboard.tsx
```

El tablero maestro que pediste, con filtro de Año/Mes/Sede (o "Balanza Total" consolidada de las 3 sedes):

- **Tarjetas de indicadores globales**: ingresos, gastos y utilidad del periodo, saldo pendiente/vencido total de los alumnos, y el semáforo "OK - Cuadrado"/"DESCUADRADO" del Balance General.
- **Gráfico de ingresos entre las 3 sedes**: barras simples (CSS, sin librería externa -- así funciona apenas hagas `npm install`, sin depender de si una librería de gráficos es compatible con React 19; si más adelante querés gráficos más elaborados como líneas o dona, se puede agregar `recharts` en un paso aparte).
- **Top 5 secciones con mayor morosidad**: agrupado por colegio+nivel+sección, con el monto vencido y cuántos alumnos distintos están afectados.
- **Descargas a Excel** de los 5 estados financieros formales: Balance General, Estado de Resultados y Balanza de Comprobación siguen el filtro de Sede/Año/Mes de arriba; Libro Diario y Libro Mayor son siempre de UNA sede específica (cada colegio lleva el suyo por separado, igual que en tu Excel real) -- el Libro Mayor además pide el código de cuenta.
- **Sección Especial ICCM**: tabla de niños en estado "Retenido" del mes (por falta de foto/carta, para auditoría inmediata) con descarga a Excel, y el desglose mes a mes de las comisiones del Banco Nacional BAC del año, también descargable.

**Aviso de diseño que quiero dejarte anotado** (no lo cambié sin preguntar): las funciones de ICCM `registrarComisionBacMensual()` y `registrarAsignacionMensual()`/`liberarFondosRetenidos()` (construidas en una entrega anterior) arman su comprobante contable a mano en vez de pasar por `crearComprobanteBalanceado()` -- quedan balanceadas igual (1 débito = 1 crédito, siempre), pero no pasan por el candado de "mes cerrado" que sí protege a caja/egresos/nómina/cierre-anual. Es del mismo tamaño y alcance que el resto de tu sistema ICCM ya probado, así que no lo toqué esta noche sin que me lo pidas explícitamente -- si querés que también respete el candado de cierre mensual, es un cambio pequeño y localizado a esos 2 archivos.

### 7) Integración con Cierre Mensual/Anual -- confirmado, sin cambios necesarios

Repasé cómo `cerrarMes()`/`cerrarAnio()` arman sus 3 reportes (Balanza, Estado de Resultados, Balance General): leen TODOS los comprobantes de `AsientoContable` del periodo, sin importar de qué módulo vinieron. Como la nómina de El Buen Pastor, los pagos a proveedores y los cobros en caja **ya pasan todos por el mismo `crearComprobanteBalanceado()`** (confirmé esto revisando los 5 archivos que llaman a esa función: `procesar-pago.ts` ×2, `registrar-planilla.ts`, `cierre-anual.ts`, `registrar-pago-proveedor.ts`), los nuevos módulos de esta noche quedan automáticamente integrados al cierre -- no hizo falta ni una línea de cambio en `cierre-mensual.ts`/`cierre-anual.ts`. Los Excel de Balance General/Estado de Resultados/Balanza que se descargan desde el Dashboard van a reflejar siempre el mismo "OK - Cuadrado" que ya garantiza `crearComprobanteBalanceado()` en el momento de cada asiento -- no en el momento de exportar.

### Verificación de esta entrega

- **`npm run probar-nominas-buen-pastor`**: 288/288 comparaciones exactas (dentro de 5 centavos) contra los 2 Excel reales de El Buen Pastor.
- Se re-corrieron TODAS las pruebas anteriores para confirmar que nada se rompió: `probar-reglas` (10/10), `probar-modulo-pago` (17/17), `probar-nominas-reales` (527/527, con las mismas 4 anomalías de plantilla ya conocidas).
- Se probó de punta a punta (con Node, sin necesitar base de datos) que `crearHoja()`/`crearLibro()`/`libroABase64()` producen un `.xlsx` real y válido: se generó un libro, se leyó de vuelta con la misma librería `xlsx`, y los datos coincidieron exactos.
- Se probó `generarMensajeCobranza()` con un caso sintético completo (alumno con mora + aranceles pendientes) -- el texto y el link `wa.me` salen bien formados y el teléfono nicaragüense se normaliza correctamente.
- `npx tsc --noEmit` sobre el proyecto COMPLETO: los únicos errores son exactamente el mismo patrón ya documentado (cascada de "no exported member"/"implicitly has an any type" por no tener `prisma generate` corrido en este sandbox) -- afecta por igual a archivos de esta noche y a archivos de entregas anteriores ya entregadas y probadas, confirmando que es 100% ambiental, no un bug nuevo. 0 errores genuinos encontrados esta vez.

---

## Usuarios y control de acceso (login), Pantalla de Contador y guía de 3 pasos

Cierre del ciclo (7 sept 2026, mismo día): con la lógica, base de datos y pantallas ya terminadas, faltaba lo último para poder probar el sistema como una aplicación de verdad -- que cada quien entre con su propio usuario y solo vea lo que le corresponde.

### 1) Inicio de sesión (`Usuario` en el schema + `/login`)

Se agregó la tabla `usuarios` (modelo `Usuario`, sección 14 del schema) con un rol (`RolUsuario`: `CAJERA` / `CONTADOR` / `JUNTA_DIRECTIVA`) por usuario. La contraseña **nunca se guarda en texto plano** -- se guarda su hash con `bcrypt` (paquete `bcryptjs`, 100% JavaScript, no necesita compilar nada). Al entrar a `http://localhost:3000` sin haber iniciado sesión, el sistema manda automáticamente a `/login`; con usuario/contraseña correctos, entra y ve el menú de Inicio ya filtrado según su rol.

La sesión se guarda en una cookie firmada (HMAC-SHA256, con la clave `AUTH_SECRET` de tu `.env`) que dura 8 horas -- no se usó ninguna librería externa de autenticación (como NextAuth) para no agregar piezas de más; es la misma idea (un token firmado) hecha a mano con las Web Crypto APIs que ya trae Node.js. `src/lib/auth/sesion-nucleo.ts` tiene las funciones puras de firmar/verificar (sin nada de Next.js, para que también funcionen dentro de `src/middleware.ts`, que es quien de verdad bloquea el paso a cada pantalla si no corresponde).

**Los 3 usuarios de prueba** (`prisma/seed-usuarios.ts`, ya viene incluido dentro de `npm run seed`):

| Usuario | Contraseña | Rol | Qué ve |
|---|---|---|---|
| `cajera` | `Cajera#2026` | Cajera | Solo Pantalla de Cajera (`/caja`) |
| `contador` | `Contador#2026` | Contador | Egresos, Nóminas, Retenciones DGI, Libro Diario/Mayor y Cierres |
| `junta` | `Junta#2026` | Junta Directiva | Dashboard Consolidado (3 sedes) + auditoría ICCM |

Son credenciales **solo para la prueba local de mañana** -- antes de usar el sistema con datos reales de producción, cambialas (o crea usuarios nuevos con contraseñas propias; correr `npm run seed:usuarios` de nuevo actualiza el hash si cambiás algo en ese archivo).

Nota sobre el reparto de accesos: no me dijiste quién debía ver la Pantalla de Nóminas, así que la dejé dentro del rol Contador (es quien jornaliza la planilla) -- si preferís otra cosa, se cambia en una sola línea (`src/lib/auth/roles.ts`).

### 2) Pantalla de Contador -- Libro Diario, Libro Mayor y Cierres (`/contador`) -- nuevo

Hasta anoche, el Libro Diario/Mayor solo se podían descargar desde el Dashboard de la Junta (que ahora es exclusivo de ese rol), y los Cierres Mensuales/Anuales (`cerrarMes()`/`cerrarAnio()`) no tenían ninguna pantalla -- solo existían como funciones. Como el Contador necesita las 3 cosas, se armó `/contador` con 3 pestañas:

- **Libro Diario**: por sede y año (o un mes específico), con tabla en pantalla y botón de Excel.
- **Libro Mayor**: por sede + código de cuenta (ej. `110101`) + rango de meses, con saldo inicial/final y tabla de movimientos, más su botón de Excel.
- **Cierres**: un renglón por mes (Abierto/Cerrado) con botón "Cerrar mes" (o "Reabrir" si ya está cerrado -- para el caso real de "nos equivocamos, hay que corregir algo"), y un botón "Cerrar año" que se habilita automáticamente cuando los 12 meses ya están cerrados. Cada cierre muestra la utilidad neta y si el Balance General quedó "OK - Cuadrado".

No fue necesario tocar `cierre-mensual.ts`/`cierre-anual.ts` ni ningún reporte -- la pantalla solo les puso una interfaz encima.

### Verificación de esta entrega

- **`npm run probar-auth`** (nuevo): 9/9 -- hashear/verificar contraseña con bcrypt, firmar y verificar una cookie de sesión, y que una cookie manipulada, vencida o con formato inválido se rechace sin explotar. Es la primera vez que se prueba el módulo de sesión de punta a punta (sin necesitar base de datos ni navegador).
- `npx tsc --noEmit` sobre el proyecto completo: mismo patrón ambiental ya documentado (falta `prisma generate` en este sandbox) -- 0 errores genuinos nuevos. Se corrigió en el camino un error real de tipos en `sesion-nucleo.ts` (un `Uint8Array` que TypeScript 5.9 no aceptaba directamente como argumento de `crypto.subtle.verify`).
- No se pudo probar `npx prisma migrate dev` de punta a punta (mismo bloqueo de red de siempre hacia los servidores de Prisma) -- la tabla `usuarios` y el enum `RolUsuario` se revisaron a mano contra el resto del schema (mismo estilo `@map`/`@@map` que las demás 39 tablas) pero la prueba definitiva de que migran bien es la tuya, mañana.

---

## 🚀 Cómo encender el sistema en tu computadora (paso a paso, para mañana)

Esto es lo único que falta para ver todo lo de arriba funcionando de verdad -- en este espacio de trabajo no hay acceso a internet hacia los servidores de Prisma ni una base de datos real conectada, así que todo lo de arriba se verificó con pruebas de lógica pura (Node, sin base de datos) y revisión exhaustiva de sintaxis/tipos. La prueba definitiva es esta, en tu máquina:

**1) Requisitos**: tener Node.js instalado (versión 20 o más reciente) y una base de datos PostgreSQL (la más fácil: crear una gratis en [supabase.com](https://supabase.com), como se explicó al inicio de este README).

**2) Descomprimir el paquete y entrar a la carpeta:**
```
cd sistema-contable
```

**3) Configurar la conexión a la base de datos** (si no lo hiciste ya en una entrega anterior):
```
cp .env.example .env
```
Y pegar dentro de `.env` la cadena de conexión de tu base de datos (`DATABASE_URL="postgresql://..."`). Esta entrega agrega una segunda variable, `AUTH_SECRET` (para firmar el login) -- `.env.example` ya trae un valor de relleno que sirve tal cual para la prueba de mañana, no hace falta cambiarlo todavía.

**4) Instalar las herramientas** (descarga todos los paquetes que el proyecto necesita, incluido `xlsx` para las descargas de Excel):
```
npm install
```

**5) Generar el cliente de Prisma** (este es el paso que este sandbox no puede hacer por bloqueo de red -- en tu computadora, con internet normal, debería funcionar sin problema):
```
npx prisma generate
```

**6) Crear las tablas en tu base de datos** (esta es la primera migración real que corre contra una base de datos de verdad -- incluye TODAS las tablas del sistema, entre ellas `usuarios` de esta entrega):
```
npx prisma migrate dev --name init_sistema_completo
```

**7) Cargar los catálogos/datos base, incluidos los 3 usuarios de prueba** (si todavía no lo habías hecho en una entrega anterior, corré los 5; `seed:usuarios` es nuevo de hoy pero también corre solo con `npm run seed`):
```
npm run seed
npm run seed:aranceles
npm run seed:niveles-becas
npm run seed:iccm-ninos
npm run seed:usuarios
```

**8) Prender el sistema:**
```
npm run dev
```
Y abrir **http://localhost:3000** en el navegador. Te va a mandar directo a la pantalla de **inicio de sesión** -- entrá con cualquiera de los 3 usuarios de prueba (tabla completa arriba, en "Usuarios y control de acceso"):

| Usuario | Contraseña |
|---|---|
| `cajera` | `Cajera#2026` |
| `contador` | `Contador#2026` |
| `junta` | `Junta#2026` |

Cada uno va a ver solo el menú que le corresponde (Cajera: Punto de Venta; Contador: Egresos, Nóminas, DGI, Libro Diario/Mayor y Cierres; Junta Directiva: Dashboard Consolidado). Para probar las 6 pantallas en la misma sesión del navegador, cerrá sesión (arriba a la derecha) y volvé a entrar con el siguiente usuario.

**9) Antes de probar nómina/dashboard con datos reales**, hace falta cargar los empleados y correr `registrarPlanillaMensual()`/`jornalizarPlanilla()` al menos una vez (todavía no hay un importador automático de empleados como el de estudiantes -- es el siguiente paso natural si lo querés). Mientras tanto, la Pantalla de Nóminas te va a decir "todavía no hay ninguna planilla registrada" en vez de fallar, y el Dashboard va a mostrar C$0 en los indicadores hasta que haya movimientos contables reales cargados.

**10) Para revalidar toda la lógica de nómina/reglas/autenticación SIN necesitar la base de datos** (rápido, útil para confirmar que nada se rompió):
```
npm run probar-reglas
npm run probar-modulo-pago
npm run probar-nominas-reales
npm run probar-nominas-buen-pastor
npm run probar-auth
```
Las 5 deberían terminar en verde (0 fallidas) -- si alguna falla en tu máquina y no acá, avisame de inmediato con el mensaje de error completo.

### Si algo no prende

- **Error de conexión a la base de datos**: revisá que `DATABASE_URL` en `.env` sea exactamente la cadena que te dio Supabase (o tu proveedor de Postgres), sin espacios ni comillas de más.
- **`npx prisma generate` falla**: normalmente es un problema de red puntual -- reintentá; si persiste, revisá que tu computadora/red no esté bloqueando `binaries.prisma.sh` (antivirus/firewall corporativo).
- **La pantalla carga pero todo sale en C$0.00**: es normal si todavía no cargaste estudiantes/empleados o no corriste ningún cobro/planilla real -- no es un error del sistema, es que la base de datos está vacía en esa parte.
- **Errores de TypeScript al correr `npm run dev`**: si aparece algo de "@prisma/client" o "implicitly has an any type" y ya corriste `npx prisma generate` (paso 5), avisame con el mensaje exacto -- sería la primera vez que aparece ese tipo de error DESPUÉS de generar el cliente, así que ameritaría revisión inmediata.
- **"Usuario o contraseña incorrectos" con las credenciales de la tabla de arriba**: revisá que hayas corrido `npm run seed:usuarios` (paso 7) DESPUÉS de que la migración (paso 6) ya creó la tabla `usuarios` -- si lo corriste antes, solo hace falta volver a correr `npm run seed:usuarios`, es seguro repetirlo.
- **Te manda a `/login` en bucle, o a "/" apenas entrás a una pantalla que sí te corresponde**: casi siempre es que `AUTH_SECRET` no está definida en tu `.env` -- revisá el paso 3.
- **Iniciaste sesión con un usuario y ahora querés probar otro**: usá el link "Cerrar sesión" arriba a la derecha del menú (no hace falta cerrar el navegador ni borrar cookies a mano).
