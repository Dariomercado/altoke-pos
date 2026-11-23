/**
 * El proceso HTTP (docs/specs/0003-api-y-sync.md §Infraestructura).
 *
 * Por ahora sólo `GET /salud`. La regla del endpoint: **no mentir y no reventar**. Si Postgres no
 * contesta, la respuesta sigue siendo 200 y dice `db: "down"`: un health check que devuelve 500
 * cuando la base está caída confunde al proxy con el diagnóstico.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import type { Consultable } from './db.ts'

export type EstadoBase = 'up' | 'down'

export type OpcionesServidor = {
  readonly pool: Consultable
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

  app.get('/salud', async () => ({
    ok: true,
    db: await comprobarBase(opciones.pool),
  }))

  return app
}
