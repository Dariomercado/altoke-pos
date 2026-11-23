# @altoke/api

El proceso del servidor de M2: Fastify, un pool de `pg` y migraciones en SQL plano. Sin ORM y sin
`dotenv`. El contrato está en [`docs/specs/0003-api-y-sync.md`](../../docs/specs/0003-api-y-sync.md).

**La red nunca decide una venta.** Este proceso es un segundo par de ojos y un lugar donde juntar
terminales; la terminal cobra igual sin él.

## Correrlo

Node ≥ 22 ejecuta los `.ts` de este paquete **directamente** (type stripping): no hay paso de build.
Por eso el código no usa enums, parameter properties ni `namespace` — sólo `import type` y tipos
planos.

```bash
# 1. Postgres local (puerto 5435, base/usuario/password: altoke)
#    La API NO usa ese usuario: conecta como `altoke_app`, un rol sin ownership ni DDL que crea el
#    init script del contenedor (volumen nuevo) o la migración 0002 (base ya inicializada).
pnpm db:up

# 2. Esquema — esto sí como dueño (`altoke`)
DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm db:migrate

# 3. API en http://localhost:3001 — runtime como `altoke_app`
DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke pnpm --filter @altoke/api dev
```

Si preferís un archivo en vez de exportar variables:

```bash
node --env-file=apps/api/.env src/index.ts
```

`.env` y `.env.*` están en el `.gitignore` de la raíz (`!.env.example` sigue versionado): las
credenciales locales no se commitean.

## Variables de entorno

| Variable                 | Obligatoria | Por defecto     | Qué hace                                             |
| ------------------------ | ----------- | --------------- | ---------------------------------------------------- |
| `DATABASE_URL`           | **sí**      | —               | Cadena de conexión del pool **de la API**: el rol sin ownership (`altoke_app`). Sin ella el proceso no arranca y lo dice con el nombre de la variable. |
| `MIGRATIONS_DATABASE_URL`| no          | `DATABASE_URL`  | Cadena de conexión del **dueño del esquema**, que corre `pnpm db:migrate`. Opcional: si falta, se usa `DATABASE_URL`.           |
| `PORT`                   | no          | `3001`          | Puerto HTTP. Entero entre 1 y 65535.                 |
| `NODE_ENV`               | no          | `development`   | Entorno declarado.                                    |

La validación vive en [`src/config.ts`](src/config.ts) y falla **antes** de abrir el puerto.

### Dos roles, no uno

Postgres **no aplica RLS al dueño de la tabla**: si la API conectara como `altoke` —dueño del
esquema— el aislamiento por tenant sería decorativo. Por eso:

- `altoke` es el dueño: corre migraciones (`MIGRATIONS_DATABASE_URL`) y nada más.
- `altoke_app` es el rol de la API (`DATABASE_URL`): `USAGE` en el schema `public`,
  `SELECT/INSERT/UPDATE/DELETE` en las tablas de datos y `USAGE` en las secuencias. **Sin ownership
  y sin DDL**: no puede crear ni alterar tablas, y no puede escribir `schema_migrations`.

El rol existe por dos caminos que dejan la base igual: un volumen nuevo lo crea
[`docker/initdb/00_rol_app.sql`](docker/initdb/00_rol_app.sql) (montado en
`/docker-entrypoint-initdb.d`), y una base ya inicializada lo crea la migración
[`migrations/0002_rol_app.sql`](migrations/0002_rol_app.sql). La contraseña `altoke_app` es **de
local**: en el VPS se rota al crear la base.

## Endpoints

### Forma única de error

Todo error, incluido un 500 y una ruta inexistente, responde con la forma de `0003` §Errores:

```json
{ "error": { "code": "validacion", "mensaje": "El email no es válido.", "detalle": { "campo": "email" } } }
```

| `code`               | HTTP | Cuándo                                                        |
| -------------------- | ---- | ------------------------------------------------------------- |
| `no_autenticado`     | 401  | sin token, token con forma inválida, vencido, revocado o credenciales incorrectas |
| `sin_permiso`        | 403  | el usuario no es miembro de ese tenant, o su rol no alcanza   |
| `tenant_desconocido` | 404  | `X-Tenant` o `:slug` no existe                                |
| `validacion`         | 400  | input inválido, email/slug/sucursal ya tomados, tenant sin elegir, JSON malformado |
| `conflicto_de_secuencia` | 409 | reservado; el sync **no** lo usa: un conflicto de secuencia entra en el 200 como item de `conflictos` con su `motivo` |
| `demasiados_intentos`| 429  | reservado; M2 no limita intentos                              |
| `error_interno`      | 500  | falla del servidor: el detalle queda en el log, nunca en la respuesta |
| `no_encontrado`      | 404  | ruta inexistente, para no romper la forma única               |

### Salud

`GET /salud` → `{ ok: true, db: "up" | "down" }`, siempre 200.

Comprueba el pool con `SELECT 1`. Si Postgres no contesta, responde `db: "down"` y **no** revienta:
un health check que miente o que devuelve 500 cuando la base está caída es peor que ninguno.

### Auth (`0003` §Auth)

| Método   | Ruta                                   | Quién         | Respuesta |
| -------- | -------------------------------------- | ------------- | --------- |
| `POST`   | `/auth/registro`                       | público       | 201: `{ token, expiraEn, usuario, tenant, rol, sucursal }` |
| `POST`   | `/auth/sesion`                         | público       | 200: `{ token, expiraEn, usuario, tenant, rol }` |
| `GET`    | `/auth/yo`                             | autenticado   | 200: `{ usuario, membresias: [{ tenantId, slug, nombre, rol }] }` |
| `DELETE` | `/auth/sesion`                         | autenticado   | 204 |
| `POST`   | `/tenants/:slug/terminales`            | `owner`/`admin` | 201: `{ id, nombre, tenantId, sucursal }` |
| `POST`   | `/tenants/:slug/usuarios/:id/password` | `owner`/`admin` | 200: `{ ok: true }` |
| `POST`   | `/sync/eventos`                        | `cajero`/`admin`/`owner` | 200: `{ aceptados, duplicados, conflictos, rechazados, acuse, huecos }` |
| `GET`    | `/sync/eventos?terminalId=&desde=`     | cualquier rol (incluido `solo_lectura`) | 200: `{ eventos, acuse, hayMas, siguienteDesde }` |

- **Reset de contraseña:** `owner`/`admin` y el rol del objetivo **estrictamente menor** que el del
  actor (`owner` → `admin`/`cajero`/`solo_lectura`; `admin` → `cajero`/`solo_lectura`). Resetear a
  alguien de tu rol o de uno mayor es `sin_permiso`, no `validacion`. Un reset exitoso revoca las
  sesiones vigentes del objetivo; la sesión propia sobrevive a un auto-reset.

- **Transporte:** `Authorization: Bearer <token>`. El token son 32 bytes base64url, se muestra
  **una sola vez** y el servidor guarda sólo su SHA-256 en `sesiones`, con vida de 12 h.
- **Contraseñas:** `scrypt` de `node:crypto` (N=2^14, r=8, p=1, sal de 16 bytes), guardadas como
  `scrypt$N$r$p$sal$hash`. Los parámetros viajan con el hash: subirlos es una migración, no una
  reescritura.
- **Email desconocido y contraseña incorrecta** son indistinguibles: mismo `no_autenticado`, mismo
  mensaje y el mismo costo de `scrypt` (sin usuario se deriva contra un hash señuelo).
- **Registro atómico:** usuario + tenant + membresía `owner` + sucursal `Principal` + sesión en una
  transacción. Un email o slug tomado es `validacion` con `detalle.campo` y no deja nada a medias.
- **`X-Tenant`:** el slug (o el id) del tenant con el que se atiende el pedido. Con una sola
  membresía se puede omitir; con varias es obligatorio, y el servidor no elige al azar.
- **Rol:** se lee de `membresias` para el tenant elegido. Un tenant ajeno es `sin_permiso`, nunca un
  resultado vacío que parezca éxito.

### Decisiones que `0003` §Auth deja abiertas

El spec fija la forma y los códigos; estas son las elecciones de T3 donde no dice nada:

- **Duplicados:** email o slug ya tomados → `400 validacion` con `detalle.campo` (`email`,
  `tenant.slug`). No se usa 409: el cliente lo resuelve corrigiendo el campo.
- **Normalización:** email y slug se guardan en minúsculas; un email con mayúsculas entra a la misma
  cuenta. El slug acepta minúsculas, números y guiones, y el largo es 2–40 de verdad: un slug de un
  carácter o de 41 es `validacion` con `detalle.campo: "tenant.slug"`.
- **Login con varios tenants:** la sesión guarda el tenant más antiguo como predeterminado y
  `X-Tenant` elige otro después. `GET /auth/yo` devuelve todas las membresías para que el POS
  muestre el selector.
- **Terminales:** `0003` §Esquema no tiene tabla `terminales`, así que el endpoint devuelve el id
  (uuid) que la terminal usa como `terminalId` en el sync; todavía no persiste nada más que la
  sucursal. `sucursal` llega como nombre y se reusa o se crea dentro del tenant: el nombre es único
  por tenant (`lower(nombre)`, índice `0004_sucursal_por_nombre.sql`), así que dos pedidos
  simultáneos que piden la misma sucursal nueva terminan con una sola fila y con el mismo id.
- **Reset de contraseña:** lo hace `owner`/`admin` sobre un miembro del tenant (no hay email
  transaccional en M2) y sólo si el rol del objetivo es **estrictamente menor** que el del actor,
  comparado con el retículo de [`src/roles.ts`](src/roles.ts): `owner` resetea a `admin`, `cajero`
  y `solo_lectura`; `admin` resetea a `cajero` y `solo_lectura`; nadie resetea a alguien de su
  mismo rol o de uno mayor, y `cajero`/`solo_lectura` no resetean a nadie (tampoco llegan a la
  ruta). Resetear a un rol igual o superior es `sin_permiso`, no `validacion`: el pedido está bien
  formado, lo que falta es permiso. La propia contraseña la puede cambiar cualquier rol que llegue
  a la ruta.
- **Sesiones y reset:** un reset exitoso **revoca todas las sesiones vigentes del usuario
  objetivo** — si se reemplaza una credencial, lo que se firmó con la vieja deja de servir en el
  acto y el usuario vuelve a entrar con la contraseña nueva. La excepción es la sesión desde la que
  el actor resetea su **propia** contraseña, que se conserva: no se echa de la pantalla a quien
  está operando. Esto es comportamiento y está cubierto por tests, no un hueco pendiente de
  auditoría de sesiones.
- **`membresias` y RLS:** `GET /auth/yo` y la elección de tenant necesitan leer las membresías
  propias antes de saber cuál es el tenant. La migración `0003_membresias_propias.sql` agrega una
  política `FOR SELECT` sobre `usuario_id = app.usuario_id`, seteado por el servidor desde la sesión.
  El aislamiento por tenant sigue intacto y escribir una membresía sigue exigiendo `app.tenant_id`.

### Sync entre terminales (`0003` §Sync)

La cola de sync es **"eventos con secuencia mayor al último acuse"**, no un rango de fechas: el orden
lo da `secuencia` por terminal y el acuse del servidor. La terminal cobra igual sin este endpoint; el
servidor junta terminales y detecta lo que no cierra.

#### Empujar — `POST /sync/eventos`

```json
{ "terminalId": "caja-1", "eventos": [ /* Evento[] del libro */ ] }
```

```json
{
  "aceptados": [{ "id": "evt-1", "secuencia": 1 }],
  "duplicados": [],
  "conflictos": [{ "id": "evt-2", "secuencia": 2, "motivo": "…" }],
  "rechazados": [{ "id": "evt-3", "motivo": "…" }],
  "acuse": { "terminalId": "caja-1", "ultimaSecuencia": 2 },
  "huecos": [3]
}
```

- **Idempotencia por `(tenant, terminal, secuencia)`**, y la arbitra la base: cada evento se inserta
  con `ON CONFLICT (tenant_id, terminal_id, secuencia) DO NOTHING` y después se relee lo guardado.
  Un "si no existe, insertalo" desde la aplicación deja una ventana en la que cabe otra terminal.
- **Mismo cuerpo → `duplicados`** (un reintento después de una respuesta perdida no duplica nada) y
  **otro cuerpo → `conflictos`**, con `motivo`. La comparación es canónica (JSON con claves
  ordenadas): `jsonb` no conserva el orden de las claves, así que comparar `JSON.stringify` contra lo
  releído marcaría conflicto hasta en el reintento idéntico.
- **`eventos.id` es único en todo el servidor.** Un id reusado en otra secuencia es un conflicto, no
  una escritura: el servidor **nunca reescribe un evento** ni completa una secuencia faltante.
- **Un evento inválido no aborta el lote.** Se valida con `validarEvento` del dominio y con el schema
  de `@altoke/contracts`, y lo que falla vuelve en `rechazados` con su `motivo` mientras sus hermanos
  se escriben. Un rechazo sin `id` utilizable se identifica por su posición (`eventos.3`).
- **El tenant y la terminal salen de la sesión.** Un evento que declara otro `tenantId` o otro
  `terminalId` que el del pedido se rechaza y no se escribe: el cuerpo es del cliente, la pertenencia
  no. Un `terminalId` inventado sólo puede escribir dentro del tenant de quien lo manda.

**`huecos` (adición a `0003` §Empujar).** El spec pide el acuse y no dice cómo reportar los huecos.
`acuse.ultimaSecuencia` es el máximo **contiguo** desde 1 —no el máximo—, así que la lista de
secuencias faltantes que la terminal todavía debe viaja en `huecos` (un tope de 200: un salto de 1 a
10⁹ no puede volverse una respuesta de mil millones de números, y `acuse.ultimaSecuencia` ya dice
dónde está el primer hueco, que es lo que hace falta para reenviar). Acusar más allá de un hueco
sería decirle a la terminal que deje de reenviar eventos que nunca llegaron, y eso pierde ventas.

El acuse se persiste en `acuses` con `GREATEST(...)`: nunca retrocede. Un `GET` no lo escribe.

#### Traer — `GET /sync/eventos?terminalId=…&desde=…`

```json
{
  "eventos": [ /* Evento[] */ ],
  "acuse": { "terminalId": "caja-1", "ultimaSecuencia": 3 },
  "hayMas": true,
  "siguienteDesde": "2026-11-23T03:00:29.123456Z"
}
```

- **Excluye la terminal que pide**: esos eventos ya están en su libro. Trae los de las demás
  terminales del tenant.
- **Orden `(recibido_en, id)`** con página de **200** y `hayMas` = "existe la página siguiente" (se
  pide una fila de más, no se cuenta).
- **`desde` es opcional y, si viene, ISO-8601**; ausente significa "desde el principio".
- **`siguienteDesde` (adición a `0003` §Traer).** El contrato del spec devuelve `hayMas` y ningún
  cursor: un cliente que recibe `hayMas: true` no tiene con qué armar la página siguiente, porque
  `Evento` no lleva `recibidoEn`. `siguienteDesde` es el `desde` exacto de la próxima página y
  `null` cuando no hay más — viaja explícito, nunca ausente, porque un campo ausente se leería como
  "no pidas más". No se deriva del último evento: el cliente no tiene que reimplementar el cursor, y
  una página vacía o de borde lo dejaría sin nada sobre lo que apoyarse. Es ISO con microsegundos:
  truncarlo a milisegundos repite el evento de la frontera (y un `ajuste_stock` aplicado dos veces es
  stock mal contado).
- **`solo_lectura` puede traer.** Leer es exactamente lo que hace ese rol; empujar no.

#### Por qué `recibido_en` es único por tenant

`recibido_en` es `DEFAULT now()`, el reloj de la **transacción**: todos los eventos de un lote de una
terminal nacerían con el mismo valor, y el cursor `recibido_en > desde` perdería a los empatados justo
al cortar una página. Por eso T5 escribe `recibido_en` evento por evento, estrictamente creciente
(`GREATEST(clock_timestamp(), max(recibido_en) + 1 µs)`) y la migración
[`0005_eventos_recibido_en_unico.sql`](migrations/0005_eventos_recibido_en_unico.sql) lo hace cumplir
con un índice único `(tenant_id, recibido_en)`. Si dos transacciones concurrentes caen en el mismo
microsegundo, el índice rechaza a una y el `INSERT` reintenta con un reloj posterior (tres intentos y
se rinde con un 500 que el cliente puede reintentar: empujar es idempotente).

Cualquier escritor nuevo de `eventos` tiene que asignar `recibido_en` creciente, no dejarlo al
`DEFAULT` de una transacción con más de una fila.

#### `terminalId` lo lleva el cliente

`0003` §Esquema **no tiene tabla `terminales`**: no hay registro de terminales contra el que validar
un `terminalId`. El id lo lleva el cliente (el que devuelve `POST /tenants/:slug/terminales`), tiene
que ser un texto no vacío de hasta 64 caracteres, y como toda fila se escribe con el `tenant_id` de
la sesión, un id inventado no puede tocar datos de otro tenant: a lo sumo se crea una cola propia
dentro del tenant de quien lo manda. Dos terminales que compartan `terminalId` comparten cola y se
pisarían secuencias: no lo hagas.

Las respuestas de las dos rutas se validan contra `@altoke/contracts` antes de salir; si el contrato
no las acepta, es un bug del servidor y responde 500 en vez de un cuerpo raro.

### Aislamiento por tenant en las consultas

Toda consulta autenticada corre en una conexión dedicada con `BEGIN` + `SELECT set_config('app.tenant_id', $1, true)`
(la forma parametrizable de `SET LOCAL`) + `COMMIT/ROLLBACK` + `release()`. El setting muere con la
transacción: una conexión devuelta al pool nunca arrastra el tenant de un pedido anterior.

## Migraciones

`apps/api/migrations/*.sql`, en orden de nombre de archivo, una por transacción, registradas en
`schema_migrations (nombre, aplicado_en)`. Un advisory lock de Postgres impide que dos runners se
intercalen.

```bash
pnpm db:migrate        # desde la raíz, con la URL del dueño
pnpm --filter @altoke/api migrate
```

`migrate` usa `MIGRATIONS_DATABASE_URL` y, si no está, `DATABASE_URL`: el rol de la API no tiene
DDL, así que migrar como `altoke_app` falla a propósito.

Es idempotente: lo ya aplicado se informa como `ya aplicada` y no se re-ejecuta. Una migración que
falla se revierte entera y no queda registrada.

Para agregar una migración: un archivo nuevo con el siguiente número (`0002_...sql`). Nunca se edita
una migración ya aplicada en producción.

## Tests

```bash
pnpm test                     # toda la suite
```

Los tests del esquema y del runner necesitan `DATABASE_URL`; sin ella se **omiten con un aviso
explícito** en la salida (omitir no es pasar):

```bash
pnpm db:up
DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke \
MIGRATIONS_DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm test
```

Los tests del esquema migran como dueño y los de RLS y auth conectan como `altoke_app`: sin las dos
variables no hay forma de probar que el aislamiento por tenant se aplica de verdad. Los de auth
cubren el alta atómica, que el token y la contraseña no queden en claro, token vencido, token
revocado, `solo_lectura` sin permiso, un token del tenant A pidiendo el tenant B, la comparación de
roles y la revocación de sesiones del reset, y dos carreras reales (dos altas simultáneas con el
mismo tenant y dos terminales simultáneas con la misma sucursal nueva): nunca un 500 y nunca una
fila duplicada.

Los de sync (`src/sync-postgres.test.ts`) cubren el mismo lote dos veces (`aceptados` y después
`duplicados`, sin filas nuevas), el mismo `(terminal, secuencia)` con otro cuerpo (`conflicto` y la
fila intacta), un `id` reusado, un evento inválido entre válidos, el acuse contiguo con sus huecos,
la traída que excluye la terminal propia, el aislamiento entre tenants, `solo_lectura` empujando
`sin_permiso` y trayendo sin problema, y el paginado con eventos escritos **en un mismo lote**: 201
eventos se traen 200 + 1 sin perder el de la frontera, que es el caso que un `now()` de transacción
perdía en silencio.

Los tests que no necesitan base usan un doble (`src/dobles.ts`) que devuelve filas guionadas y
registra cada consulta con su conexión: así se verifica que `BEGIN`, `set_config`, `COMMIT` y
`release()` ocurren en la misma conexión.
