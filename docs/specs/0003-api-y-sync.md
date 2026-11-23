# 0003 — API y sync (M2)

Complementa `0001` (arquitectura) y `0002` (fiscal). Define el contrato entre la terminal y el
servidor: qué se manda, qué se recibe, quién puede hacerlo y qué pasa cuando algo no cierra.

Regla que manda sobre todas: **la red nunca decide una venta**. La terminal cobra, escribe en su libro
local y encola. El servidor es un segundo par de ojos y un lugar donde juntar terminales, no un
requisito para cobrar (`0001` §I2).

## Infraestructura

Un VPS chico con Postgres. Un proceso Node (`apps/api`) con Fastify, un pool de `pg`, migraciones en
SQL plano aplicadas por un runner propio. Sin ORM: el esquema es la fuente de verdad y RLS se apoya en
`SET LOCAL app.tenant_id`, que un ORM esconde y termina rompiendo.

Superficie pública: `api.altoke.app` (HTTP/2, TLS del proxy). El POS web vive en otro origen
(`slug.altoke.app`), así que CORS es explícito: sólo los orígenes de tenant declarados, con
credenciales.

## Esquema

`tenant_id` en **toda** tabla de datos, sin excepción (`0001` §6).

```
tenants        (id, slug unique, nombre, modo_fiscal, creado_en)
sucursales     (id, tenant_id, nombre)
usuarios       (id, email unique, nombre, password_hash, creado_en)
membresias     (usuario_id, tenant_id, rol)            pk (usuario_id, tenant_id)
sesiones       (token_hash pk, usuario_id, tenant_id, creada_en, expira_en, revocada_en)
eventos        (id unique, tenant_id, terminal_id, secuencia, tipo,
                ocurrido_en, schema_version, cuerpo jsonb, recibido_en)
                pk (tenant_id, terminal_id, secuencia)
acuses         (tenant_id, terminal_id, ultima_secuencia)  pk (tenant_id, terminal_id)
outbox_fiscal  (id, tenant_id, venta_id, estado, intentos, proximo_intento_en,
                motivo, creado_en)                      — vacía en M2, ver §Outbox fiscal
```

Roles (`0001` §6): `owner`, `admin`, `cajero`, `solo_lectura`. Por tenant, nunca globales.

RLS en `eventos`, `acuses`, `outbox_fiscal`, `sucursales` y `membresias`:

```sql
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Dos detalles que hacen que esto no sea decorativo:

- **`current_setting(..., true)` es null-safe.** Sin `app.tenant_id` seteado la política no filtra nada
  hacia afuera: devuelve **cero filas**, no un error. Una credencial que se olvidó de setear el
  tenant tiene que ver nada, no explotar con un 500 que alguien va a "arreglar" aflojando la política.
- **El dueño de la tabla no queda sujeto a RLS.** Por eso hay dos roles: `altoke` es dueño y sólo
  corre migraciones; `altoke_app` es con quien se conecta el API, no tiene DDL ni ownership y sí queda
  filtrado. Medido con dos tenants sembrados: dueño ve 2 eventos, `altoke_app` sin tenant seteado ve
  0, con tenant A ve 1 (y 0 del B).

La aplicación, además, filtra por `tenant_id` en cada consulta. RLS es la red de seguridad, no la
única defensa (`0001` §6).

## Auth

Sin proveedor externo y sin email transaccional en M2: el alta la hace el dueño y el reseteo de
contraseña lo hace un `admin` del tenant. Todo lo que no sea eso, después.

- Hash: `scrypt` de `node:crypto` (N=2^14, r=8, p=1, salt de 16 bytes). Sin dependencias nativas.
- Token de sesión: 32 bytes aleatorios en base64url. El servidor guarda **sólo el SHA-256**. Vida 12 h
  (un turno), revocable.
- Transporte: `Authorization: Bearer <token>`. La terminal lo guarda en IndexedDB, no en
  `localStorage`: sobrevive a recargar la pestaña sin quedar expuesto al `document` entero.

Endpoints:

```
POST   /auth/registro   { email, password, nombre, tenant: { nombre, slug } } → sesión + tenant
POST   /auth/sesion     { email, password }                                  → sesión
GET    /auth/yo                                                              → usuario, membresías
DELETE /auth/sesion                                                          → revoca el token
POST   /tenants/:slug/terminales  { nombre, sucursal }      (owner|admin)     → terminal
```

`GET /auth/yo` devuelve las membresías para que el POS sepa qué mostrar: `solo_lectura` no ve
COBRAR; `cajero` cobra pero no toca marca ni cierre ajeno; `admin` y `owner` sí.

## Sync

Semántica: **la cola de sync es "eventos con secuencia mayor al último acuse"** (`0001` §I2). Nada de
timestamps ni de relojes sincronizados.

### Empujar

```
POST /sync/eventos
  { terminalId, eventos: Evento[] }        (rol cajero, admin, owner)

  200 {
    aceptados:   [{ id, secuencia }],
    duplicados:  [{ id, secuencia }],      // ya estaban, mismo cuerpo: no-op
    conflictos:  [{ id, secuencia, motivo }],
    rechazados:  [{ id, motivo }],         // fallan validación de dominio o de esquema
    acuse: { terminalId, ultimaSecuencia }
  }
```

Reglas:

- **Idempotencia por `(tenant, terminal, secuencia)`**. Mismo id y mismo cuerpo → `duplicados`, no
  error: un reintento después de una respuesta perdida no puede duplicar nada.
- **Mismo `(tenant, terminal, secuencia)` con cuerpo distinto → `conflicto`**. No se pisa: el servidor
  guarda el primero y reporta. Dos terminales no deberían compartir `terminalId`.
- Rechazo por validación (`validarEvento` del dominio, más el schema zod de `@altoke/contracts`) no
  escribe nada.
- El servidor **no reescribe** eventos ni completa secuencias faltantes: un hueco se reporta como
  hueco, no se inventa.

### Traer

```
GET /sync/eventos?terminalId=...&desde=<recibidoEn ISO>
  200 { eventos: Evento[], acuse: { terminalId, ultimaSecuencia }, hayMas: boolean }
```

Devuelve los eventos del tenant con `recibido_en > desde`, **excluyendo los de la propia terminal**
(esos ya están en su libro). Paginado por `desde` (cursor de tiempo del servidor) con `hayMas`.

Cada evento recibido se valida con `validarEvento` **antes** de aplicarse al libro local. Uno inválido
no se aplica: se descarta y se cuenta, porque un evento corrupto no puede envenenar la proyección de
stock.

### Sobreventa

Si al aplicar una venta la proyección de stock queda negativa, el servidor **no la rechaza** (`0001`:
"sobreventa explícita"). Escribe un evento `sobreventa_detectada` con el detalle y lo devuelve en el
próximo `GET`. El POS lo muestra como alerta: la mercadería salió, el papel no miente.

### `schemaVersion`

Cada evento declara la versión con la que se escribió (`0001` §2). Al leer, el servidor y la terminal
aplican la misma cadena de migraciones antes de validar: `vN → vN+1 → …` en memoria, nunca
reescribiendo lo guardado. En M2 sólo existe `v1`; la cadena y su test viven desde ahora para que la
primera migración real no sea un descubrimiento.

## Outbox fiscal

`0002` §3: el outbox se construye en M2 **aunque esté vacío**, porque agregarlo después obliga a tocar
el camino de la venta.

- Tabla `outbox_fiscal` y tipo `EmisionFiscal` en `packages/domain` con los estados
  `pendiente → emitido | fallido`, `intentos` y `proximo_intento_en`.
- En F0 el cobro **no encola nada**: la estructura existe, el camino está escrito y apagado.
- El cobro nunca espera al outbox. Una venta sin comprobante es una venta válida con deuda
  documental (`0002` §3).

## Errores

Forma única: `{ error: { code, mensaje, detalle? } }`. Códigos: `no_autenticado`, `sin_permiso`,
`tenant_desconocido`, `validacion`, `conflicto_de_secuencia`, `demasiados_intentos`. Nada de stack
traces al cliente; el log del servidor guarda el detalle.

## Fuera de alcance de M2

- F1, F2 y F3 (`0002` §7: M3, M4, M5+).
- Email transaccional, recuperación de contraseña self-service, invitaciones.
- App nativa Android/iOS: primero PWA (`0001` §5). El dominio sigue siendo TypeScript puro para que
  `SqliteStore` sea posible sin reescribir reglas.
- Publicación del producto en una URL abierta: la demo va detrás de un candado y la producción real
  por tenant es una decisión aparte.
