/**
 * Transacciones y el tenant de la conexión.
 *
 * Regla dura de docs/specs/0003-api-y-sync.md §Esquema: `app.tenant_id` se setea con `SET LOCAL`
 * dentro de la transacción que corre la consulta, **nunca** sobre una conexión del pool que
 * después puede recibir otro pedido. `SET LOCAL` (acá, en su forma parametrizable
 * `set_config(..., true)`) muere con la transacción; una conexión devuelta al pool no arrastra el
 * tenant del pedido anterior.
 *
 * Por eso toda consulta autenticada pasa por `enTransaccionDeTenant`: una conexión dedicada,
 * `BEGIN`, `set_config`, el trabajo, `COMMIT`/`ROLLBACK` y `release()`.
 */

import type { Consultable, FuenteDeConexiones } from './db.ts'

export type Trabajo<T> = (conexion: Consultable) => Promise<T>

export async function enTransaccion<T>(fuente: FuenteDeConexiones, trabajo: Trabajo<T>): Promise<T> {
  const conexion = await fuente.connect()

  try {
    await conexion.query('BEGIN')
    const resultado = await trabajo(conexion)
    await conexion.query('COMMIT')
    return resultado
  } catch (error) {
    try {
      await conexion.query('ROLLBACK')
    } catch {
      // La conexión ya no sirve: liberarla es lo único que queda. El error original es el que
      // explica por qué falló el pedido.
    }
    throw error
  } finally {
    conexion.release()
  }
}

/** `SET LOCAL app.tenant_id = ...`, parametrizado: `SET` no acepta parámetros, `set_config` sí. */
export async function fijarTenant(conexion: Consultable, tenantId: string): Promise<void> {
  await conexion.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId])
}

/**
 * Para las consultas que no tienen tenant todavía (resolver la sesión, listar las membresías
 * propias). La política `membresias_propias` usa este setting; sin él, RLS devuelve 0 filas.
 */
export async function fijarUsuario(conexion: Consultable, usuarioId: string): Promise<void> {
  await conexion.query('SELECT set_config($1, $2, true)', ['app.usuario_id', usuarioId])
}

export async function enTransaccionDeTenant<T>(
  fuente: FuenteDeConexiones,
  tenantId: string,
  trabajo: Trabajo<T>,
): Promise<T> {
  return enTransaccion(fuente, async (conexion) => {
    await fijarTenant(conexion, tenantId)
    return trabajo(conexion)
  })
}

export async function enTransaccionDeUsuario<T>(
  fuente: FuenteDeConexiones,
  usuarioId: string,
  trabajo: Trabajo<T>,
): Promise<T> {
  return enTransaccion(fuente, async (conexion) => {
    await fijarUsuario(conexion, usuarioId)
    return trabajo(conexion)
  })
}
