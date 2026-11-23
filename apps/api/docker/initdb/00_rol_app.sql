-- 00_rol_app.sql — el rol con el que atiende la API, en un volumen NUEVO.
--
-- Postgres sólo corre este directorio cuando el volumen de datos está vacío. La otra ruta, una base
-- ya inicializada, es `apps/api/migrations/0002_rol_app.sql`: el mismo rol y los mismos grants, para
-- que una base vieja y una nueva terminen igual.
--
-- Por qué existe el rol (0003 §Esquema, 0001 §6): RLS no se aplica al dueño de la tabla. Si la API
-- conecta como `altoke` —dueño del esquema— el aislamiento por tenant es decorativo. `altoke`
-- corre migraciones y nada más; `altoke_app` es quien atiende, sin ownership y sin DDL.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'altoke_app') THEN
    -- Contraseña local de desarrollo, la misma del docker-compose. En el VPS se rota al crear la
    -- base: este archivo es una credencial de local, no de producción.
    CREATE ROLE altoke_app LOGIN PASSWORD 'altoke_app'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Sin USAGE en el schema no llega ni a las tablas de las que es GRANTee.
GRANT USAGE ON SCHEMA public TO altoke_app;

-- Las tablas todavía no existen cuando corre este script: los grants de datos los da la migración
-- 0002. Acá se deja listo el futuro: lo que cree el dueño después nace con permiso para la API.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO altoke_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO altoke_app;
