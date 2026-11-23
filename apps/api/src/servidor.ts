/**
 * El proceso HTTP (docs/specs/0003-api-y-sync.md §Infraestructura).
 *
 * `GET /salud` y las rutas de auth y de administración del tenant. La regla del health check:
 * **no mentir y no reventar**. Si Postgres no contesta, la respuesta sigue siendo 200 y dice
 * `db: "down"`: un health check que devuelve 500 cuando la base está caída confunde al proxy con
 * el diagnóstico.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Consultable, FuenteDeConexiones } from './db.ts'
import { registrarManejadoresDeError } from './errores.ts'
import { registrarRutasAuth } from './rutas-auth.ts'
import { registrarRutasTenants } from './rutas-tenants.ts'

export type EstadoBase = 'up' | 'down'

export type OpcionesServidor = {
  /**
   * Pool de `pg` (o un doble en los tests). Es `FuenteDeConexiones` y no sólo `Consultable`
   * porque las consultas autenticadas necesitan una conexión dedicada para `SET LOCAL
   * app.tenant_id` dentro de su transacción.
   */
  readonly pool: FuenteDeConexiones
  readonly logger?: boolean
}

export async function comprobarBase(pool: Consultable): Promise<EstadoBase> {
  try {
    await pool.query('SELECT 1')
    return 'up'
  } catch {
    return 'down'
  }
}

export function crearServidor(opciones: OpcionesServidor): FastifyInstance {
  const app = Fastify({ logger: opciones.logger ?? false })

  registrarManejadoresDeError(app)

  app.get('/salud', async () => ({
    ok: true,
    db: await comprobarBase(opciones.pool),
  }))

  registrarRutasAuth(app, opciones.pool)
  registrarRutasTenants(app, opciones.pool)

  return app
}
