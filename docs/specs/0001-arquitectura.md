# AlToke — Spec técnica 0001: Arquitectura

**Estado:** propuesta para discusión. Sin código todavía.
**Decide:** forma del sistema, modelo de datos, límites entre paquetes.
**No decide:** fiscalidad y cobros electrónicos → ver `0002-fiscal-y-cobros.md`.

---

## 0. Qué es AlToke

Plataforma multi-tenant para kioscos y tiendas de barrio chico/mediano. POS que sigue cobrando sin
internet, catálogo y stock, cierre de turno, y cada cliente ve el sistema con su propia marca.

**Dos familias de cliente, y no son el mismo producto:**

| | Kiosco | Tienda (ropa, ferretería, juguetería) |
|---|---|---|
| SKUs | 500–2.000, rotación altísima | 200–2.000, rotación baja y estacional |
| Variantes | prácticamente ninguna | **talle/color, medida/presentación** |
| Ritmo de venta | decenas por hora | pocas por hora |
| Devoluciones | casi nulas | **frecuentes** |
| Fiscal | consumidor final | **a menudo B2B, con Factura A** |
| Efectivo | mayoría | menos; más tarjeta y transferencia |
| Qué le duele | perder la venta por falta de stock | **capital inmovilizado** |

El POS, el cierre de caja y el branding son idénticos. El catálogo y la fiscalidad no. Todo lo que
sigue tiene que servir para las dos sin bifurcar el núcleo.

**No es** un ERP. **No es** un facturador. Es el mostrador.

---

## 0.1 Alcance del segmento: kioscos primero

**Glosario, para que no vuelva a haber ambigüedad:** en estos documentos **"tienda" significa
comercio de nicho con inventario chico o mediano** (juguetería, tienda de ropa, ferretería). **No**
significa "kiosco más grande". Un kiosco de 800 ventas diarias sigue siendo un kiosco: alta rotación,
sin variantes, consumidor final.

**Foco de lanzamiento: kioscos.** Ninguna de las razones es técnica:

- **Densidad.** Hay miles en una ciudad: los visitás a pie, en un solo día.
- **Uniformidad.** Todos tienen el mismo dolor (quiebre de stock, cola al mediodía) y hacen lo mismo.
  Un demo sirve para los cincuenta.
- **Catálogo barato de armar.** Todo tiene código de barras: escaneás y el producto ya existe con
  nombre y foto. Cargar 500 productos es una tarde.
- **Fiscal simple.** Consumidor final. Sin Factura A, sin B2B.
- **Deciden rápido**, y el ticket es bajo: la venta es de volumen y no de consultoría.

Una ferretería es lo opuesto en las cuatro dimensiones: catálogo carísimo de armar, cada una es
distinta, decisión lenta, y muchas piden Factura A.

### Qué queda preparado para el nicho, pagado hoy a costo casi cero

| Pieza | Estado |
|---|---|
| Catálogo con ejes de variante (talle/color/medida) | **en el modelo desde M1** |
| `item_devuelto` para devolución parcial | **en el modelo desde M1** |
| Matriz de 4 modos fiscales, incluido B2B | **en `0002`, sin código extra** |
| Multi-sucursal | en el modelo desde M1 |

### Qué costaría agregar el nicho después

| Pieza | Costo |
|---|---|
| Selector de variante en el POS | 1–2 días |
| Flujo de cambio (devuelvo + me llevo otra) | 2–3 días |
| Listas de precios y liquidación | 2–3 días |
| Reporte de stock muerto | 1 día |
| **Alta de catálogo sin código de barras** | **semanas, y es problema de negocio, no de código** |

El software es una semana. **El onboarding del catálogo es el verdadero foso:** si el cliente tiene
2.000 productos sin código, sin foto y con nombres inventados por el dueño, alguien los tiene que
cargar a mano. Eso es soporte, no producto — y es la razón por la que el nicho es un mercado distinto
y no una configuración distinta.

**Conclusión: arrancar con kioscos no cierra ninguna puerta y ahorra el mes más caro del proyecto.**

---

## 0.2 Modelo comercial: pago único

Decisión del usuario: **pago único, no suscripción.**

Tiene una consecuencia arquitectónica dura: **el costo marginal por tenant debe tender a cero.**
Un ingreso que ocurre una sola vez contra un costo que ocurre todos los meses hace que cualquier
componente que escale con la cantidad de clientes convierta el éxito en pérdida.

| Permitido | Prohibido |
|---|---|
| Un VPS chico para sync y auth de todos los tenants | Una instancia o base de datos por cliente |
| Datos que viven en el dispositivo del kiosco | Guardar catálogo o fotos de producto en el servidor |
| Backups comprimidos y agregados | Servir imágenes de producto desde la nube |
| Un CDN estático para el SPA | Generar PDFs del lado del servidor |

Y refuerza el local-first por una razón **económica** y no sólo de resiliencia: si los datos viven en
el kiosco, el servidor sólo mueve deltas.

**Advertencia que no es arquitectónica pero condiciona todo:** el pago único paga la infraestructura
—que es baratísima— pero **no paga el soporte ni el mantenimiento**, que son tiempo y no terminan
nunca. La estructura sostenible es: pago único con 12 meses de actualizaciones y soporte incluidos, y
renovación anual opcional al 25–30% del inicial. **Nunca se bloquea el sistema**: el cliente que no
renueva sigue cobrando con la versión que tiene, sin actualizaciones ni soporte. Eso es lo que hace
que la promesa "es tuyo" sea verdadera y sostenible a la vez.

### Reglas de la renovación

$$\text{renovación} = 25\text{–}30\% \times \text{precio inicial de instalación}$$

| Momento | Qué paga | Qué recibe |
|---|---|---|
| Instalación (día 0) | 100% del precio | licencia + instalación + catálogo + 12 meses de soporte y actualizaciones |
| Cada aniversario | 25–30% del inicial | 12 meses más de lo mismo |

1. **El porcentaje se calcula siempre sobre el precio inicial de instalación**, nunca sobre la
   renovación anterior. No compone.
2. **Si no renueva, no se le apaga nada.** Sigue cobrando y cerrando caja con la versión que tiene.
   Pierde versiones nuevas y soporte. Nada más.
3. **Si vuelve, paga el año corriente.** Sin penalidad y sin acumular los años salteados. El objetivo
   es que vuelva, no castigarlo.
4. **Aviso 30 días antes.** Una renovación sorpresa es una renovación perdida.

**Incluye:** versiones nuevas, corrección de errores y soporte por WhatsApp en el horario declarado.
Nada más, y nada menos.

**Dos cosas que no se hacen:**

- **No bloquear el sistema.** Rompe la promesa central y obliga a mantener un kill switch que es a la
  vez riesgo técnico y riesgo reputacional.
- **No prometer features futuras como carnada.** Si prometés el sync para el año que viene y no llega,
  perdés el cliente y la palabra. La renovación se sostiene en soporte, actualizaciones y
  **cumplimiento fiscal**: el año que el organismo cambie algo, el que no renovó queda con un sistema
  que ya no factura bien. Ese año la renovación se vende sola.

**Por qué esto protege al desarrollador y no sólo al negocio:** en una ciudad chica no se le puede
negar soporte a un cliente que te conoce. Sin un marco explícito, el soporte gratuito ocurre igual,
pero sin ingreso y sin reconocimiento. La renovación es lo que da un límite conversable.

---

## 1. Los tres invariantes

Todo lo demás se deriva de estos tres. Si una decisión futura rompe uno, se rechaza.

### I1 — El dominio no conoce la red ni el storage

`packages/domain` es TypeScript puro: funciones que reciben datos y devuelven datos. Cero `fetch`,
cero `localStorage`, cero `import` de React, cero I/O salvo lo que se inyecta explícitamente por
parámetro.

**Por qué:** es lo único que hace que "preparado para Android con SQLite" sea verdad y no una
promesa de powerpoint. La app mobile importa el mismo dominio, sin reescribir reglas de negocio.

**Consecuencia práctica:** si un test del dominio necesita red o base de datos, el dominio está mal
escrito.

### I2 — Todo efecto externo es asincrónico y reintentable

Emitir un comprobante fiscal, cobrar en un posnet, sincronizar con el servidor: los tres son
**efectos externos** que pueden fallar. Ninguno bloquea la venta.

Un solo patrón: **outbox**. La operación se registra localmente con estado `pendiente`, la UI avanza,
y un worker intenta el efecto con reintentos y backoff. Fallar no invalida la venta; la deja en un
estado visible y accionable.

**Por qué:** es la respuesta al corte de internet. Y es también la razón por la que no hace falta
resolución de conflictos distribuida (ver §3).

### I3 — El dinero se calcula una sola vez, en centavos enteros

Sin floats. Sin `parseFloat` en el camino crítico. Unidad: **centavos**, `number` entero, validado por
zod como `int()`.

El formato (`$1.234,56`) existe sólo en el borde de presentación, con `Intl.NumberFormat('es-AR')`.
Nunca se reformatea un número para volver a calcular con él.

Redondeo: **half-up al centavo**, como función pura testeada en el dominio.

**Detalle argentino que el diseño de Stitch no captó:** el PVP que ve el cliente **ya incluye IVA**.
El costo y el margen se calculan *invirtiendo* el IVA, no sumándolo. Si esto no queda en el dominio
desde el día uno, los márgenes del inventario van a estar mal por 21% y nadie lo va a notar hasta que
el dueño haga números con su contador.

---

## 2. El modelo: libro de eventos, no tablas mutables

La decisión con más consecuencias de todo el proyecto.

Una venta **no** es una fila que se actualiza. Es una secuencia de eventos inmutables:

```ts
type Evento =
  | { tipo: 'turno_abierto';    id: string; terminalId: string; fondoCentavos: number }
  | { tipo: 'venta_iniciada';   id: string; terminalId: string; turnoId: string }
  | { tipo: 'item_agregado';    ventaId: string; sku: string; cantidad: number; precioUnitarioCentavos: number }
  | { tipo: 'item_quitado';     ventaId: string; sku: string; cantidad: number }
  | { tipo: 'item_devuelto';    ventaId: string; sku: string; cantidad: number; motivo: string }
  | { tipo: 'descuento';        ventaId: string; montoCentavos: number; motivo: string }
  | { tipo: 'pago_registrado';  ventaId: string; medio: MedioPago; montoCentavos: number }
  | { tipo: 'venta_confirmada'; ventaId: string; totalCentavos: number }
  | { tipo: 'venta_anulada';    ventaId: string; motivo: string }
  | { tipo: 'ajuste_stock';     sku: string; delta: number; causa: string }
  | { tipo: 'turno_cerrado';    turnoId: string; declaradoCentavos: number }
```

Cada evento lleva: `id` (ULID), `tenantId`, `terminalId`, `secuencia` (monotónica por terminal),
`ocurridoEn` (ISO-8601), `schemaVersion`.

### Qué se gana

- **Sync trivial.** Un terminal es el único escritor de su rango de secuencia. Mergear es concatenar
  y ordenar. Sin `UPDATE`, sin last-write-wins, sin CRDT.
- **Offline real.** La cola de sync es literalmente "eventos con secuencia mayor al último acuse del
  servidor". No hace falta una cola aparte.
- **Auditoría gratis.** Quién anuló, cuándo, con qué motivo. Un kiosco con dos empleados y plata de
  por medio necesita esto antes de lo que uno cree.
- **Fiscalidad posible.** Un CAE que falla es un estado del evento, no una venta corrupta.
- **Mismo formato en web y en Android.** El dominio produce eventos; el adaptador los persiste.

### Qué se paga

- **Proyecciones.** La UI necesita "stock actual" y "total del turno" ya calculados, no reconstruir
  40.000 eventos en cada render. Se mantienen snapshots materializados, recalculables desde cero.
- **Volumen.** Un kiosco hace ~300 ventas/día × ~6 eventos ≈ 1.800 eventos/día ≈ 650k/año. Trivial
  para IndexedDB o SQLite; trivial para Postgres con índice por `(tenant_id, terminal_id, secuencia)`.
- **Disciplina.** Nadie escribe `UPDATE stock SET ...`. El stock es una proyección.

### El catálogo: el SKU es una matriz, no una fila

El mockup de Stitch —y la primera versión de este documento— asumía catálogo de kiosco: un producto,
un precio, un stock. Una tienda de ropa **sin talle y color es inutilizable**; una ferretería sin
presentación (unidad vs caja de cien) tampoco.

**La decisión:** el evento mantiene `sku` como unidad atómica —no se agrega `varianteId` al libro de
ventas— pero el **producto** tiene ejes de variante desde el día uno, y el SKU se **deriva** de la
combinación.

```
producto: Remera Básica
  ejes: [ { nombre: 'Talle', valores: ['S','M','L'] },
          { nombre: 'Color', valores: ['Negro','Blanco'] } ]
  → SKUs: REM-BAS-S-NEG  REM-BAS-S-BLA  REM-BAS-M-NEG  REM-BAS-M-BLA  ...
```

Por qué así y no de la otra forma:

- El libro de ventas no se contamina: `item_agregado` sigue llevando un solo `sku`.
- El stock sigue siendo por SKU, que es lo que existe físicamente en el depósito.
- El POS muestra un selector de variante **sólo** para productos que la tienen.
- Un kiosco nunca ve el selector, porque sus productos tienen cero ejes.

**Costo de hacerlo ahora:** medio día en el modelo de catálogo.
**Costo de hacerlo después:** migrar cada evento `item_agregado` ya sincronizado, con clientes
cobrando. Es exactamente la clase de cambio que prohíbe el §7 del documento 0002.

### Devoluciones parciales

`venta_anulada` cubre sólo el caso completo. Una tienda devuelve **un** ítem de tres, o hace un cambio
(devuelve una remera y se lleva otra). Ese caso necesita `item_devuelto` desde el inicio, porque un
evento que no existe no se puede reconstruir después — sólo se puede inventar, y eso ya es corrupción
de datos.

### Anti-patrón a evitar desde el minuto cero

No hacer "event sourcing canónico" con aggregates, command handlers, snapshotting por versión y un bus
de eventos. Eso es para sistemas con auditoría regulatoria estricta y equipos grandes.

Acá necesitamos tres funciones: **append**, **proyectar**, **leerDesde**. Nada más.

---

## 3. Por qué no hace falta resolver conflictos

El único conflicto real: dos terminales venden la última unidad del mismo SKU.

El servidor lo resuelve como **sobreventa explícita**: ambas ventas valen (ya se cobraron), el stock
queda negativo, y se emite un evento `sobreventa_detectada` que la UI muestra como alerta.

Un kiosco ya opera así — vende el último alfajor y después se da cuenta de que no había. Nada de
locks distribuidos, reservas optimistas ni CRDT: la realidad del negocio no lo pide y el costo es
enorme.

**Lo que sí importa** (y no es un conflicto de datos): que el cajero nunca vea un error por falta de
red. Eso lo resuelve I2, no la teoría de conflictos.

---

## 4. Puertos

Todo lo que toca el mundo exterior es una interfaz. Cuatro puertos, no veinte.

```ts
// packages/store — persistencia local
interface PosStore {
  append(eventos: Evento[]): Promise<void>
  leerDesde(terminalId: string, secuencia: number): Promise<Evento[]>
  proyectar<T>(proyeccion: Proyeccion<T>): Promise<T>
}
// Adaptadores: IndexedDbStore (web) · SqliteStore (Android) · MemoryStore (tests)

// packages/store — transporte al servidor
interface SyncTransport {
  empujar(tenantId: string, eventos: Evento[]): Promise<Acuse>
  traer(tenantId: string, desde: number): Promise<Evento[]>
}

// packages/integraciones — comprobante fiscal
interface ComprobanteEmitter {
  capacidades(): CapacidadesFiscales
  emitir(venta: VentaConfirmada): Promise<IntentoComprobante>
}

// packages/integraciones — cobro electrónico
interface CobroTerminal {
  capacidades(): CapacidadesCobro
  cobrar(solicitud: SolicitudCobro): Promise<IntentoCobro>
}
```

`CapacidadesFiscales` y `CapacidadesCobro` son la pieza clave: un adaptador **declara lo que puede
hacer** y la UI se adapta. No se finge que todos los proveedores son equivalentes. Detalle en `0002`.

---

## 5. Estructura del repositorio

```
altoke/
  apps/
    web/            Vite + React + TS · SPA · PWA · sin SSR
    api/            Hono + PostgreSQL · HTTP/JSON
  packages/
    domain/         lógica pura · sin I/O · sin React          ← el corazón
    store/          puertos + adaptadores de persistencia
    integraciones/  puertos + adaptadores fiscal / cobro
    contracts/      schemas zod compartidos web ↔ api
    ui/             tokens + componentes (light/dark)
  docs/specs/
  odd/tasks/
```

Gestor: **pnpm workspaces**. TypeScript `strict`. `tsconfig` base compartido.

**Sin Next.js, sin server actions, sin RSC.** La web es un SPA que habla HTTP.

Esto no es preferencia estética: **un SPA es la única forma de que el POS siga cobrando cuando la API
no responde**. El modelo de ejecución de Next con server actions mete al servidor en el camino crítico
de escritura, que es exactamente lo que I2 prohíbe.

**Por qué monorepo y no un solo paquete:** porque `domain` y `contracts` tienen que ser importables por
la app Android sin arrastrar React ni el bundler web. Si viven en el mismo paquete que la UI, la
separación es decorativa y se pierde en la primera semana de apuro.

---

## 6. Multi-tenancy

- **Modelo:** una base, `tenant_id` en toda tabla, **Postgres RLS** como red de seguridad — no como
  única defensa: el filtro por tenant también se aplica en la capa de acceso.
- **Identidad:** `slug` único → `slug.altoke.app`.
- **Jerarquía:** `tenant` → `sucursal` → `terminal`. La marca es del tenant; precios y stock pueden
  diferir por sucursal.
- **Roles:** `owner`, `admin`, `cajero`, `solo_lectura`. **Por tenant, no globales.** Un usuario puede
  pertenecer a varios tenants — el dueño con tres kioscos es un caso real y frecuente, no un borde.
- **Aislamiento en el cliente:** la base local de un terminal contiene **sólo su tenant**. Al cerrar
  sesión, se purga.

---

## 7. Diseño y branding

- **Tokens como CSS custom properties**, no como objeto de config de Tailwind duplicado en cinco
  archivos (el error de Stitch).
- `data-theme="light" | "dark"` en `<html>`. **Claro por defecto**, oscuro opcional.
- La marca del tenant sobreescribe **cinco variables**: primario, acento, superficie, texto, logo.
  Nada más. Si un cliente necesita más que eso, es un pedido de diseño, no de configuración.
- Los tokens de Stitch se migran **una vez**, arreglando el drift documentado (el `.md` declara radios
  y acentos que el HTML no usa).
- **Touch primero:** targets de 44px, sin ocultar scrollbars, contraste AA. El POS se usa de pie, con
  una mano y con luz de vidriera.

---

## 8. Testing

- **`domain`: el 80% del esfuerzo.** Funciones puras, deterministas, sin mocks, tiempo inyectado
  (nunca `Date.now()` adentro).
  - Aritmética de dinero: tabla de casos, incluyendo redondeo de IVA y precio con IVA incluido.
  - Arqueo: propiedad verificable — `fondo + cobros − retiros === teórico`, para cualquier combinación
    de denominaciones.
- **`store`: la misma suite contra los tres adaptadores.** El contrato de `PosStore` se escribe una vez
  y se corre contra IndexedDB, SQLite y memoria. Esto es lo que hace confiable al adaptador Android sin
  probarlo en un teléfono.
- **`web`: un puñado de tests de flujo**, no de componente. Cobrar, anular, cerrar turno.
- **Nada de snapshots de UI como red de seguridad.** Se rompen solos y nadie los mira.

---

## 9. Fuera del modelo a propósito

- Facturación fiscal mutable → `0002`.
- Listas de precios y promociones combinadas → el modelo guarda el precio aplicado en
  `item_agregado`, así que se agrega después sin migrar nada.
- Cuenta corriente / fiado → hay lugar (`medio: 'cuenta_corriente'`), pero la gestión de la cuenta es
  M3.
- Compras y proveedores → no está en el mockup y no lo necesita el demo.
- Impresión: primer render del ticket en HTML/CSS a 80mm. Sin librería de PDF.

---

## 10. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Sobre-ingeniería del libro de eventos | Semanas perdidas | Tres funciones: `append`, `proyectar`, `leerDesde`. Nada más. |
| Sync entre terminales mal resuelto | Stock mentiroso | Sobraventa explícita + alerta visible. Sin locks. |
| Dominio contaminado con React | Adaptador Android imposible | Regla de lint: `packages/domain` no importa `react` ni `apps/*` |
| Complejidad fiscal temprana | Bloquea el demo | Puerto con adaptador nulo desde M1. Ver `0002`. |
| Un solo desarrollador | Todo tarda el doble | Milestones cortos y no negociables. |
