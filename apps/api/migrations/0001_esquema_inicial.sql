-- 0001_esquema_inicial.sql — esquema de M2 (docs/specs/0003-api-y-sync.md §Esquema).
--
-- Reglas que este archivo hace cumplir:
--   * `tenant_id` en toda tabla de datos. Los datos de un tenant no se mezclan con los de otro.
--   * Claves primarias que son el orden del libro: `eventos` se ordena por (tenant, terminal,
--     secuencia), nunca por reloj.
--   * RLS como red de seguridad en `eventos`, `acuses`, `outbox_fiscal`, `sucursales` y
--     `membresias`: la aplicación además filtra por `tenant_id` en cada consulta (0001 §6).
--
-- Se aplica una sola vez, entera, sobre una base vacía. El runner
-- (`apps/api/src/migraciones.ts`) la envuelve en su propia transacción y la registra en
-- `schema_migrations`; si algo falla, no queda ni la mitad.

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  nombre      text NOT NULL,
  -- Fase fiscal del tenant (0002 §7). F0 es el ticket interno: `ninguno`.
  modo_fiscal text NOT NULL DEFAULT 'ninguno'
    CHECK (modo_fiscal IN ('ninguno', 'controlador_fiscal', 'factura_electronica')),
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sucursales (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  nombre    text NOT NULL
);

CREATE INDEX sucursales_tenant_idx ON sucursales (tenant_id);

CREATE TABLE usuarios (
  -- El email es único en todo el sistema: con él se entra y después se elige tenant.
  -- El alta la hace un `owner` y el reseteo un `admin` del tenant (0003 §Auth).
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  nombre         text NOT NULL,
  password_hash  text NOT NULL,
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE membresias (
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  -- Roles de 0001 §6: por tenant, nunca globales.
  rol        text NOT NULL CHECK (rol IN ('owner', 'admin', 'cajero', 'solo_lectura')),
  PRIMARY KEY (usuario_id, tenant_id)
);

CREATE INDEX membresias_tenant_idx ON membresias (tenant_id);

CREATE TABLE sesiones (
  -- Del token se guarda sólo el SHA-256: si alguien lee esta tabla no tiene con qué entrar.
  token_hash text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  creada_en  timestamptz NOT NULL DEFAULT now(),
  expira_en  timestamptz NOT NULL,
  revocada_en timestamptz
);

CREATE INDEX sesiones_usuario_idx ON sesiones (usuario_id);

CREATE TABLE eventos (
  -- ULID opaco del dominio: único, pero no lo ordena nada. El orden lo da `secuencia`.
  id             text NOT NULL UNIQUE,
  tenant_id      uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  terminal_id    text NOT NULL,
  secuencia      bigint NOT NULL,
  tipo           text NOT NULL,
  ocurrido_en    timestamptz NOT NULL,
  schema_version integer NOT NULL,
  cuerpo         jsonb NOT NULL,
  -- Reloj del servidor: es el cursor de `GET /sync/eventos`, no el orden del libro.
  recibido_en    timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia por (tenant, terminal, secuencia): dos terminales no comparten terminal_id.
  PRIMARY KEY (tenant_id, terminal_id, secuencia)
);

-- La PK ya es el índice de (tenant_id, terminal_id, secuencia). Falta el del cursor de lectura.
CREATE INDEX eventos_tenant_recibido_en_idx ON eventos (tenant_id, recibido_en);

CREATE TABLE acuses (
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  terminal_id     text NOT NULL,
  ultima_secuencia bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, terminal_id)
);

CREATE TABLE outbox_fiscal (
  -- Construida y vacía en M2: en F0 el cobro no encola nada (0002 §3). El camino existe para
  -- que agregarla después no obligue a tocar el cobro.
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  venta_id            text NOT NULL,
  estado              text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'emitido', 'fallido')),
  intentos            integer NOT NULL DEFAULT 0,
  proximo_intento_en  timestamptz,
  motivo              text,
  creado_en           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbox_fiscal_pendientes_idx ON outbox_fiscal (tenant_id, estado, proximo_intento_en);

-- Aislamiento por tenant. `current_setting('app.tenant_id')` sin `missing_ok` revienta si la
-- aplicación no lo setea: la política falla cerrada, no abierta.
-- La aplicación, además, filtra por tenant_id en cada consulta (0001 §6).
-- Nota: en Postgres el dueño de la tabla no queda sujeto a RLS; el rol de conexión de la API se
-- decide en T3.

ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eventos
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE acuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON acuses
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE outbox_fiscal ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox_fiscal
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sucursales
  USING (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE membresias ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON membresias
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
