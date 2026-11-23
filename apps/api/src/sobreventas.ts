/**
 * Detección de sobreventa en el servidor (docs/specs/0003-api-y-sync.md §Sobreventa, tarea T6).
 *
 * `0001` §3: dos terminales del mismo tenant pueden vender la última unidad del mismo SKU. Las dos
 * ventas valen —la mercadería salió—, el stock proyectado queda negativo y el libro lo dice con un
 * `sobreventa_detectada` que el POS muestra como alerta.
 *
 * Reglas que este archivo hace cumplir:
 *
 *   - **Se detecta al aceptar el evento de la venta, en la misma transacción.** Si la venta entra y
 *     el proceso se cae antes de contar la sobreventa, el hueco no se puede reconstruir después: la
 *     detección no corre al leer (un `GET` no escribe), así que nadie más la va a encontrar.
 *   - **El stock se proyecta con el dominio, no con SQL.** El libro ya tiene una sola definición de
 *     stock (`proyeccionStock`): recalcularla en SQL sería una segunda definición que se desvía con
 *     el primer tipo de evento nuevo.
 *   - **Una sobreventa por venta y SKU.** La arbitra la base con el índice único parcial
 *     `eventos_sobreventa_unica` (0006): un reintento del mismo empuje, o dos líneas del mismo SKU,
 *     no agregan una segunda alerta. `guardarEvento` traduce el `23505` a "duplicado".
 *   - **El evento lo escribe el servidor con su identidad.** `terminalId` es `servidor` y la
 *     secuencia sale de `secuencias_servidor`, una tabla propia: nunca choca con la secuencia de una
 *     caja real ni la deja con huecos. Un cliente no puede falsificar esa identidad
 *     (`validarEventoDeCliente`).
 *   - **Se serializa por tenant.** `bloquearSobreventas` toma un advisory lock de la transacción: si
 *     dos terminales empujan la última unidad a la vez, la segunda tiene que ver la primera ya
 *     escrita, o el stock queda negativo sin que nadie lo cuente.
 *
 * Todo se llama **dentro** de la transacción del empuje, con `app.tenant_id` seteado
 * (`enTransaccionDeTenant`): RLS es la red de seguridad y además cada consulta filtra por
 * `tenant_id` explícito (0001 §6).
 */

import { randomUUID } from 'node:crypto'
import { TERMINAL_DEL_SERVIDOR, proyeccionStock, proyectar, validarEvento } from '@altoke/domain'
import type { Evento } from '@altoke/domain'
import type { EventoSync } from '@altoke/contracts'
import type { Consultable } from './db.ts'
import { guardarEvento } from './eventos.ts'

/**
 * Toma el lock de detección de sobreventas del tenant hasta el final de la transacción.
 *
 * Es el único lock y se toma **antes** de escribir en el libro (ver `empujarLote`), así que no hay
 * ciclo posible con las filas de `eventos`. Se llama sólo cuando el lote trae ítems de venta: un
 * empuje que no vende nada no espera por nadie.
 */
export async function bloquearSobreventas(
  conexion: Consultable,
  tenantId: string,
): Promise<void> {
  await conexion.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
    `altoke:sobreventa:${tenantId}`,
  ])
}

/**
 * La próxima secuencia del servidor para el tenant, atómica.
 *
 * `ON CONFLICT DO UPDATE` devuelve el valor ya incrementado en la misma sentencia: dos transacciones
 * concurrentes del mismo tenant se serializan acá y ninguna ve el número de la otra.
 */
const SQL_PROXIMA_SECUENCIA = `INSERT INTO secuencias_servidor (tenant_id, ultima_secuencia)
VALUES ($1, 1)
ON CONFLICT (tenant_id) DO UPDATE
SET ultima_secuencia = secuencias_servidor.ultima_secuencia + 1
RETURNING ultima_secuencia::bigint AS secuencia`

/**
 * Los eventos del tenant que hablan de ese SKU. `cuerpo->>'sku'` deja afuera los eventos sin SKU
 * (turno, pagos, la propia sobreventa), que no mueven el stock: `proyeccionStock` los ignora.
 */
const SQL_EVENTOS_DEL_SKU = `SELECT cuerpo FROM eventos
WHERE tenant_id = $1 AND cuerpo->>'sku' = $2
ORDER BY recibido_en, id`

/** El stock proyectado del SKU según el libro ya escrito, incluida esta transacción. */
async function stockDelSku(
  conexion: Consultable,
  tenantId: string,
  sku: string,
): Promise<number> {
  const filas = await conexion.query(SQL_EVENTOS_DEL_SKU, [tenantId, sku])
  const libro = filas.rows.map((fila) => fila['cuerpo'] as Evento)

  return proyectar(libro, proyeccionStock())[sku] ?? 0
}

async function proximaSecuenciaDelServidor(
  conexion: Consultable,
  tenantId: string,
): Promise<number> {
  const fila = (await conexion.query(SQL_PROXIMA_SECUENCIA, [tenantId])).rows[0]
  const secuencia = Number(fila?.['secuencia'] ?? 0)

  if (!Number.isSafeInteger(secuencia) || secuencia <= 0) {
    throw new Error(`secuencias_servidor no devolvió una secuencia válida: ${String(secuencia)}`)
  }
  return secuencia
}

/**
 * Si el evento aceptado vendió unidades y el stock proyectado quedó negativo, escribe **el** evento
 * de sobreventa de esa venta y lo devuelve. En cualquier otro caso devuelve `null` y no escribe nada.
 *
 * `item_agregado` es el único evento que suma unidades a una venta y resta stock: `item_quitado` y
 * `item_devuelto` lo reponen, y un `ajuste_stock` no pertenece a ninguna venta, así que no hay una
 * venta a la que atribuirle la sobreventa.
 */
export async function detectarSobreventa(
  conexion: Consultable,
  tenantId: string,
  evento: EventoSync,
): Promise<Evento | null> {
  if (evento.tipo !== 'item_agregado') return null

  const stockProyectado = await stockDelSku(conexion, tenantId, evento.sku)
  if (stockProyectado >= 0) return null

  const sobreventa: Evento = {
    id: randomUUID(),
    tenantId,
    terminalId: TERMINAL_DEL_SERVIDOR,
    secuencia: await proximaSecuenciaDelServidor(conexion, tenantId),
    ocurridoEn: new Date().toISOString(),
    schemaVersion: 1,
    tipo: 'sobreventa_detectada',
    ventaId: evento.ventaId,
    sku: evento.sku,
    cantidad: evento.cantidad,
    stockProyectado,
  }

  // Lo que escribe el servidor pasa por el mismo borde que lo que escribe una terminal.
  validarEvento(sobreventa)

  const guardado = await guardarEvento(conexion, tenantId, sobreventa)
  return guardado.tipo === 'aceptado' ? sobreventa : null
}
