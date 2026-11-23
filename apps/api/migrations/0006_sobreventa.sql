-- 0006_sobreventa.sql — el evento con el que el servidor cuenta una sobreventa.
--
-- `0001` §3: dos terminales pueden vender la última unidad del mismo SKU. El servidor no rechaza la
-- segunda venta (la mercadería salió): deja el stock negativo y emite `sobreventa_detectada`
-- (0003 §Sobreventa). Dos cosas tienen que existir en la base para que eso sea cierto.
--
-- 1. **Una secuencia propia del servidor.** La identidad del libro es `(tenant, terminal,
--    secuencia)` y la secuencia es **por terminal** (`0001` §2), así que un evento de origen
--    servidor necesita su propia terminal (`servidor`, constante del dominio) y su propio contador.
--    Sin esta tabla, el servidor tendría que inventar una secuencia dentro de la de una caja —y
--    chocaría con ella, o dejaría huecos en su acuse— o usar relojes, que el libro no tiene.
--    RLS y `tenant_id` como en toda tabla de datos (`0001` §6).
--
-- 2. **Una sobreventa por venta y SKU.** La detección corre dentro de la transacción que acepta el
--    evento de la venta, y la idempotencia tiene que ser de la base y no de una consulta previa
--    (`apps/api/src/eventos.ts`): con este índice, un segundo `sobreventa_detectada` para la misma
--    `(venta, SKU)` es un `23505` que el guardado traduce a "ya estaba", no una fila repetida que
--    la UI mostraría como dos alertas. El cuerpo puede traer un solo SKU, por eso la clave es la
--    venta + el SKU y no sólo la venta.
--
-- Reversible:
--   DROP INDEX eventos_sobreventa_unica;
--   DROP TABLE secuencias_servidor;

CREATE TABLE secuencias_servidor (
  tenant_id       uuid PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
  -- Última secuencia entregada para los eventos del servidor de este tenant. Arranca en 0 y la
  -- primera que se entrega es la 1 (la secuencia del libro es positiva).
  ultima_secuencia bigint NOT NULL DEFAULT 0
);

ALTER TABLE secuencias_servidor ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON secuencias_servidor
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- La API conecta como `altoke_app` (0002): sin el grant, la tabla no existe para ella. Los default
-- privileges de 0002 ya la cubrirían; el grant explícito deja la migración legible y la vuelve
-- idempotente sobre una base migrada a mano.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE secuencias_servidor TO altoke_app;

-- Índice parcial: sólo mira las filas de sobreventa, así no impone nada sobre el resto del libro.
CREATE UNIQUE INDEX eventos_sobreventa_unica
  ON eventos (tenant_id, (cuerpo->>'ventaId'), (cuerpo->>'sku'))
  WHERE tipo = 'sobreventa_detectada';
