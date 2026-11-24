-- `eventos.id` era único en **todo el servidor**: un ULID que ya existía en otro tenant hacía que el
-- empuje de este volviera en `conflictos`, y con eso el servidor delataba la existencia de un id
-- ajeno. La clave de idempotencia es `(tenant, terminal, secuencia)`; el id es del evento, no del
-- servidor, así que se vuelve único por tenant.
--
-- Los ULID no son adivinables, pero «no adivinable» no es «aislado»: el aislamiento lo da el tenant.

ALTER TABLE eventos DROP CONSTRAINT eventos_id_key;

ALTER TABLE eventos ADD CONSTRAINT eventos_tenant_id_unico UNIQUE (tenant_id, id);

-- Reversible: `ALTER TABLE eventos DROP CONSTRAINT eventos_tenant_id_unico;` y después
-- `ALTER TABLE eventos ADD CONSTRAINT eventos_id_key UNIQUE (id);`. Ojo: la vuelta **no se puede
-- aplicar** mientras dos tenants compartan un id, y ese es justo el caso que esta migración habilita.
-- Revertir exige decidir qué id se queda con cada valor duplicado.
