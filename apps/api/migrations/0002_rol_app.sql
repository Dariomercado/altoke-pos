-- 0002_rol_app.sql — el rol de la API y las políticas de RLS que sí muerden.
--
-- Corrige dos defectos de 0001 sin editarla (una migración aplicada no se edita, ver README):
--
--   1. RLS no alcanza al dueño de la tabla. Con una sola credencial, `altoke` era dueño del esquema
--      y la API habría conectado como dueño: el aislamiento por tenant era decorativo. Acá se crea
--      `altoke_app`, el rol **no dueño** de la API. `altoke` corre migraciones y nada más.
--   2. La política de 0001 usaba `current_setting('app.tenant_id')` sin `missing_ok`: sin tenant
--      seteado no devolvía 0 filas, reventaba. Acá se recrea para que sin tenant la respuesta sea
--      0 filas: falla cerrada, no revienta.
--
-- Idempotente, para que una base nueva (0001 + 0002) y una que ya tenía el esquema sin el rol
-- terminen igual. La ruta "volumen nuevo" crea el mismo rol en `docker/initdb/00_rol_app.sql`.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'altoke_app') THEN
    -- Contraseña local de desarrollo, la misma del docker-compose. En el VPS se rota al crear la
    -- base: esto documenta el privilegio mínimo, no una credencial de producción.
    CREATE ROLE altoke_app LOGIN PASSWORD 'altoke_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Un rol que ya existía pudo nacer con más privilegios: se normaliza a lo mínimo.
ALTER ROLE altoke_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- Sin USAGE en el schema no llega ni a las tablas de las que es GRANTee.
GRANT USAGE ON SCHEMA public TO altoke_app;

-- Datos sí; esquema no. `schema_migrations` queda fuera a propósito: es del dueño, no de la API.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  tenants, sucursales, usuarios, membresias, sesiones, eventos, acuses, outbox_fiscal
  TO altoke_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO altoke_app;

-- `schema_migrations` es del dueño. En un volumen nuevo nace DESPUÉS de los default privileges del
-- init script, así que hereda los grants de datos: se revoca explícito para que el rol de la API no
-- pueda escribir la tabla que registra las migraciones, y para que una base nueva y una ya migrada
-- queden idénticas.
REVOKE ALL ON TABLE schema_migrations FROM altoke_app;

-- Lo que el dueño cree después (una migración nueva) nace con los mismos grants: si no, la API
-- andaría hoy y dejaría de andar con la primera tabla nueva.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO altoke_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO altoke_app;

-- RLS: sin `app.tenant_id`, `current_setting(..., true)` es NULL, `tenant_id = NULL` no es verdadero
-- para ninguna fila, y la consulta devuelve 0 filas en vez de fallar. Con tenant seteado, un solo
-- tenant. Desde que la API conecta como `altoke_app` (no dueño), esto se aplica de verdad.
ALTER TABLE eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON eventos;
CREATE POLICY tenant_isolation ON eventos
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE acuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON acuses;
CREATE POLICY tenant_isolation ON acuses
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE outbox_fiscal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON outbox_fiscal;
CREATE POLICY tenant_isolation ON outbox_fiscal
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sucursales;
CREATE POLICY tenant_isolation ON sucursales
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE membresias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON membresias;
CREATE POLICY tenant_isolation ON membresias
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
