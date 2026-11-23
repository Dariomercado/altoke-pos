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

`GET /salud` → `{ ok: true, db: "up" | "down" }`, siempre 200.

Comprueba el pool con `SELECT 1`. Si Postgres no contesta, responde `db: "down"` y **no** revienta:
un health check que miente o que devuelve 500 cuando la base está caída es peor que ninguno.

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

Los tests del esquema migran como dueño y los de RLS conectan como `altoke_app`: sin las dos
variables no hay forma de probar que el aislamiento por tenant se aplica de verdad.
