/**
 * El proceso HTTP (docs/specs/0003-api-y-sync.md §Infraestructura).
 *
 * `GET /salud`, las rutas de auth, las de administración del tenant y el sync entre terminales. La regla del health check:
 * **no mentir y no reventar**. Si Postgres no contesta, la respuesta sigue siendo 200 y dice
 * `db: "down"`: un health check que devuelve 500 cuando la base está caída confunde al proxy con
 * el diagnóstico.
 *
 * CORS es explícito (`0003` §Infraestructura): el POS vive en otro origen (`slug.altoke.app`) y la
 * API en `api.altoke.app`, así que sólo los orígenes de tenant **declarados** pueden llamarla, con
 * credenciales. Un origen desconocido se rechaza; nunca se refleja y nunca se emite `*`.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { leerOrigenesPermitidos } from './config.ts'
import type { Consultable, FuenteDeConexiones } from './db.ts'
import { registrarManejadoresDeError, sinPermiso } from './errores.ts'
import { registrarRutasAuth } from './rutas-auth.ts'
import { registrarRutasSync } from './rutas-sync.ts'
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
  /**
   * Orígenes de tenant permitidos. Si no se pasan se leen del entorno con la misma validación de
   * `config.ts`: el arranque real (`index.ts`) ya llama a `leerConfig`, y ésta es la única forma de
   * que el proceso de M2 no quede con CORS apagado sin tocar su arranque. Nunca hay comodín: ni
   * `*` ni "cualquiera si la lista está vacía".
   */
  readonly origenesPermitidos?: readonly string[] | undefined
}

export const MENSAJE_ORIGEN_NO_AUTORIZADO =
  'El origen de este pedido no está autorizado para hablar con la API.'

export async function comprobarBase(pool: Consultable): Promise<EstadoBase> {
  try {
    await pool.query('SELECT 1')
    return 'up'
  } catch {
    return 'down'
  }
}

/**
 * CORS explícito, sin `@fastify/cors`: son tres cabeceras y una regla.
 *
 *   - **Origen permitido:** se refleja **su** origen (nunca `*`), con credenciales y `Vary: Origin`
 *     para que un proxy no sirva la respuesta de un tenant a otro.
 *   - **Origen desconocido:** 403 con la forma única de error (`0003` §Errores). Reflejarlo "para no
 *     romper" sería dejar que cualquier página use la sesión del cajero.
 *   - **Sin `Origin`:** no es un pedido de navegador (curl, server-to-server); CORS no aplica.
 *   - **Preflight (`OPTIONS`):** se contesta con 204 y los métodos y cabeceras que las rutas usan,
 *     incluido `X-Tenant` (el selector de tenant de `0003` §Auth).
 */
export function registrarCors(
  app: FastifyInstance,
  origenesPermitidos: readonly string[],
): void {
  const permitidos = new Set(origenesPermitidos)

  app.addHook('onRequest', async (request, reply) => {
    const origen = request.headers.origin
    if (typeof origen !== 'string' || origen === '') return

    // Aunque el origen no esté permitido, la respuesta depende de `Origin`: sin esto un cache
    // podría devolverle a otro tenant una respuesta que sí llevaba `Access-Control-Allow-Origin`.
    reply.header('vary', 'Origin')

    if (!permitidos.has(origen)) throw sinPermiso(MENSAJE_ORIGEN_NO_AUTORIZADO)

    reply.header('access-control-allow-origin', origen)
    reply.header('access-control-allow-credentials', 'true')

    if (request.method !== 'OPTIONS') return

    reply.header('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
    reply.header('access-control-allow-headers', 'Authorization, Content-Type, X-Tenant')
    reply.header('access-control-max-age', '600')
    return reply.status(204).send()
  })
}

export function crearServidor(opciones: OpcionesServidor): FastifyInstance {
  const app = Fastify({ logger: opciones.logger ?? false })

  registrarManejadoresDeError(app)
  registrarCors(app, opciones.origenesPermitidos ?? leerOrigenesPermitidos(process.env))

  app.get('/salud', async () => ({
    ok: true,
    db: await comprobarBase(opciones.pool),
  }))

  registrarRutasAuth(app, opciones.pool)
  registrarRutasTenants(app, opciones.pool)
  registrarRutasSync(app, opciones.pool)

  return app
}
