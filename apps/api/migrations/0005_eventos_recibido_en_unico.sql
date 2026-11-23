-- 0005_eventos_recibido_en_unico.sql — el cursor de la traída tiene que poder avanzar sin perder
-- el empate.
--
-- `GET /sync/eventos` pagina por `recibido_en` (docs/specs/0003-api-y-sync.md §Traer): la terminal
-- pide `recibido_en > desde` con `desde` = el `siguienteDesde` de la página anterior. Si dos eventos
-- comparten `recibido_en` justo en la frontera de la página, el segundo queda detrás del cursor para
-- siempre: la página corta en 200 y la siguiente arranca en un `> desde` que ya no lo incluye.
--
-- Y compartir timestamp es lo normal, no la excepción: `DEFAULT now()` es el reloj de la
-- transacción, así que un lote entero de una terminal nace con el mismo `recibido_en`. Por eso T5
-- escribe `recibido_en` evento por evento, estrictamente creciente (ver `apps/api/src/eventos.ts`),
-- y esta migración lo hace cumplir en la base: único por tenant.
--
-- Reemplaza el índice no único de 0001 (`eventos_tenant_recibido_en_idx`), que queda cubierto por
-- este: mismo prefijo `(tenant_id, recibido_en)`, mismo uso para el `ORDER BY` del cursor.
--
-- Reversible: `DROP INDEX eventos_tenant_recibido_en_unico;`
--             `CREATE INDEX eventos_tenant_recibido_en_idx ON eventos (tenant_id, recibido_en);`

DROP INDEX eventos_tenant_recibido_en_idx;

CREATE UNIQUE INDEX eventos_tenant_recibido_en_unico ON eventos (tenant_id, recibido_en);
