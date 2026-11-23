# AlToke — M2: API y sync entre terminales

M2 convierte el POS local en un sistema con servidor: cuentas con roles, terminales que se juntan en un
tenant, y un outbox fiscal construido y vacío. El contrato vive en `docs/specs/0003-api-y-sync.md`.
La venta sigue sin depender de la red.

## Specs

**S1.** M2 es el que define `0002` §7, ni más ni menos:

> "| **M2** (sync + API) | F0, con el **outbox fiscal ya construido y vacío** | idem |"

**S2.** El servidor es un VPS chico con Postgres, como decidió el humano contra las alternativas
serverless:

> "VPS chico + Postgres (el spec)"

**S3.** Cuentas con roles desde el día uno, no un código de emparejamiento:

> "Cuentas con roles desde el día uno"

Roles de `0001` §6: `owner`, `admin`, `cajero`, `solo_lectura`, por tenant y nunca globales.

**S4.** El alcance es exactamente el del spec, sin adelantar fiscal:

> "Solo lo que dice el spec"

Es decir: sync entre terminales, migración de `schemaVersion` al leer, validación de lectura y el
outbox fiscal vacío. F1, F2 y F3 quedan en M3/M4/M5+.

**S5.** Mobile: PWA ahora, nativo después. No se toca nada nativo en M2, pero no se rompe lo que hace
posible `SqliteStore`: `packages/domain` sigue siendo TypeScript puro, sin React y sin IO.

> "PWA ahora, nativo después"

**S6.** La publicación no entra en M2. No se pone el producto en una URL abierta: la demo va detrás de
un candado y la producción por tenant es una decisión posterior.

## Invariantes que M2 no puede romper

- **La red nunca decide una venta.** Sin servidor, sin red y sin sesión, el POS cobra igual. Un error
  de sync no bloquea el cobro ni pierde la venta (`0001` §I2).
- **Nunca se pierde una venta por un problema fiscal** (`0002` §3). El outbox se construye vacío y el
  cobro no lo espera.
- **`tenant_id` en toda tabla**, RLS como red de seguridad y filtro en la capa de acceso (`0001` §6).
- **La base local de una terminal contiene sólo su tenant**; al cerrar sesión se purga.
- **Nada de relojes.** El orden lo da `secuencia` por terminal y el acuse del servidor.
- **Ningún evento se reescribe.** Un hueco se reporta; no se completa ni se corrige en silencio.
- **El ticket sigue siendo interno (F0)** y sigue diciéndolo en el papel.

## Tasks

- **T1** `apps/api`: proceso Fastify, pool de `pg`, configuración por entorno, `GET /salud`, runner de migraciones en SQL plano. → S2
- **T2** Esquema Postgres completo + RLS por `app.tenant_id` + migración inicial aplicable y reversible. → S2, S3
- **T3** Auth: `scrypt` de `node:crypto`, sesiones opacas con hash en base, `registro` / `sesion` / `yo` / revocar, y middleware de tenant + rol. → S3
- **T4** Contrato de sync en `packages/contracts` (zod) y tests de él: eventos aceptados, duplicados, conflictos de secuencia y rechazos. → S1, S4
- **T5** `POST /sync/eventos` y `GET /sync/eventos` con idempotencia por `(tenant, terminal, secuencia)`, acuse por terminal y paginado por cursor. → S1, S4
- **T6** `sobreventa_detectada`: proyección de stock en el servidor, evento nuevo en la unión del dominio y alerta en el POS. → S4
- **T7** `schemaVersion` al leer: cadena de migraciones compartida entre servidor y terminal, con un fixture `v2` sintético que la ejercite. → S4
- **T8** Outbox fiscal: tabla, tipo `EmisionFiscal` con estados, camino del cobro apagado en F0 y su test de que no encola nada. → S1
- **T9** Cliente: `SyncTransport` sobre `fetch`, cola persistida en IndexedDB, reintentos con backoff, estado de sync visible y purga de la base al cerrar sesión. → S1, S2
- **T10** Pantallas de sesión: alta de tenant, login, selección de tenant y gating por rol (`solo_lectura` no ve COBRAR). → S3
- **T11** `caja.cobrar` rechaza el cobro si el turno ya está cerrado — hueco encontrado al cerrar los follow-ups de L7. → S1
- **T12** Verificación: suite completa, typecheck, lint, build y una corrida real de dos terminales sincronizando. → S1, S4

## Log

### L1 — Pedido original de M2

> "bueno hagamos lo que quedo abierto aun y tambien hagamos M2. por otra parte te pregunto, podemos
> poner el proyecto en produccion en vercel o netlify? digo cuando ya tengamos todo bien listo asi
> despues se los presentoa a los kioscos o tiendas, el tema es que si lo pongo en produccion ya los que
> conozcan la url pueden usar el proyecto. como debo presentar esto a los kioscos una vez que lo
> tengamos listo? estamos preparando una base que cubra f0, f1 y f2, y si se requiere f3 tambien
> cierto? tambien hay que ver lo de la app mobile para android y ios y que se pueda operar offline y
> encolando como me habias dicho"

Los follow-ups abiertos (L7 del rediseño) se cerraron antes de empezar M2, en `e50f13c`.

### L2 — Corrección de alcance fiscal

No se prepara una base que cubra F0–F3 a la vez. `0002` §7 ordena: M2 con F0 y el outbox **construido
y vacío**; M3 F1 si el kiosco piloto tiene controlador fiscal; M4 F2 nivel 1; F3 no va en v1 y lo
dispara un cliente Responsable Inscripto que paga. F0 es estado de transición, no destino.

### L3 — Cuatro decisiones del humano

Tomadas contra las alternativas presentadas, con el costo de cada una a la vista:

1. **API**: VPS chico + Postgres, con RLS. Descartados Vercel serverless y Cloudflare Workers + D1
   (D1 no tiene RLS, y el spec se apoya en RLS como red de seguridad).
2. **Identidad**: cuentas con roles desde el día uno.
3. **Alcance**: sólo lo que dice el spec — sin F1 ni F2 adelantados.
4. **Mobile**: PWA ahora, nativo después.

### L4 — Consecuencias registradas de esas decisiones

- Sin email transaccional en M2: el alta la hace el dueño y el reseteo de contraseña lo hace un
  `admin`. `scrypt` de `node:crypto` en vez de Argon2: cero dependencias nativas en el VPS.
- Token de sesión en IndexedDB y no en `localStorage`, con vida de 12 h (un turno) y revocable.
- Publicación: la demo irá detrás de un candado (Cloudflare Access es el que sirve: gratis hasta 50
  usuarios) y **el producto no se publica en una URL abierta**; la producción por tenant se decide
  después de M2. Vercel Authentication protege producción gratis pero exige cuenta de Vercel, que no
  sirve para un kiosquero.

### L5 — Verificación independiente (T12)

Pasada de `gentle-ai-verify` sobre la rama completa, con la base arriba y **dos terminales reales** contra
el API arrancado (no `app.inject`): **S1–S6 met, sin blockers, 42 archivos / 516 tests**.

Lo que se verificó a mano, no por nombre de test: RLS (sin `app.tenant_id` el rol de runtime ve 0 filas
en las cinco tablas y un `INSERT` ajeno viola la política; con tenant A ve 12 eventos y 0 de B), tokens
(0 filas con token plano, hash de 64 hex, vencido y revocado dan 401), `solo_lectura` (pull 200, push
403), offline (con la API caída el libro conserva 6 eventos y el acuse queda en 0; al volver, salen los
mismos 6 ids), «nada se reescribe» (0 `UPDATE`/`DELETE` sobre `eventos` en todo el árbol; un push
conflictivo deja el mismo `md5` de cuerpo), `schemaVersion` futura rechazada al empujar, outbox fiscal
en 0 filas con el modo F0 y una venta que se escribe aunque el camino del outbox lance, y el contrato
de 80 mm intacto.

La prueba de valor de test: se mutó cada regla y se midió qué se cae. Ocho de nueve mutaciones hicieron
fallar tests. **La novena dejó la suite verde**: quitar el `pg_advisory_xact_lock` que serializa la
detección de sobreventa no rompía nada, y con el lock afuera la alerta se perdía 5 de 6 veces en una
carrera de dos conexiones. Un test in-process no la reproduce (medido: pasaba 4/4 sin el lock), así que
quedó como probe ejecutable en `odd/probes/carrera-de-sobreventa.mjs`, documentado con su porqué.

Tres defectos se corrigieron en `842ff00`:

- **Una fila ilegible dejaba ciego al tenant entero.** Un evento guardado con `schemaVersion` más nueva
  que la del código hacía fallar `traerEventos` y el `GET` devolvía 500 para todas las terminales y
  todos los eventos, para siempre: nada la puede saltear y nada puede reescribirla. Ahora se saltea, se
  cuenta y se reporta como `ilegibles`.
- **`DELETE /auth/sesion` con `Content-Type: application/json` y sin cuerpo** daba 400 y **no revocaba
  el token**. Un logout que falla en silencio es un bug de seguridad con forma de error de validación.
- El lock de sobreventa, cubierto por el probe.

Quedan anotados como follow-ups, ninguno bloqueante: el motivo de conflicto es engañoso cuando la
secuencia la ocupa otro `id`; `eventos.id` es único global entre tenants (delata la existencia de un id
ajeno, aunque los ULID no son adivinables); el rol de runtime conserva `UPDATE`/`DELETE` sobre `eventos`,
así que «nada se reescribe» lo sostiene el código y no el privilegio; no hay rate limit en el login
(`demasiados_intentos` está reservado); el tenant por defecto de una Sesión multi-membresía no tiene
test a nivel ruta; y el savepoint de sucursal no hace `RELEASE`.

### L6 — Entrega

Rama `feat/m2-sync`, 13 commits, ~14.700 líneas escritas. PR abierta contra `main`; el merge es decisión
del humano, igual que en M1.
