-- 0003_membresias_propias.sql — leer las membresías propias sin elegir un tenant antes.
--
-- Necesidad que destapó T3: `GET /auth/yo` devuelve las membresías de un usuario, y el middleware
-- necesita saber a qué tenants pertenece para elegir cuando no hay `X-Tenant`. Con sólo la política
-- de 0002 (`tenant_id = app.tenant_id`), esa lectura devuelve 0 filas porque todavía no hay tenant,
-- y el login no puede ni decir cuántos tenants tiene la cuenta.
--
-- La política agrega SELECT sobre las filas cuyo `usuario_id` coincide con `app.usuario_id`, un
-- setting que el servidor setea **después** de validar el token y siempre desde la sesión (nunca
-- desde el cliente). Las políticas permisivas se suman: el aislamiento por tenant sigue intacto
-- para todo lo demás, y un usuario ve sus propias membresías, que son suyas por definición.
--
-- Es sólo SELECT: escribir una membresía sigue exigiendo `app.tenant_id` como en 0002.

DROP POLICY IF EXISTS membresias_propias ON membresias;
CREATE POLICY membresias_propias ON membresias
  FOR SELECT
  USING (usuario_id = nullif(current_setting('app.usuario_id', true), '')::uuid);
