/**
 * Arranque del proceso: configuración, pool y Fastify.
 *
 * Node ≥ 22 ejecuta este `.ts` directamente (type stripping): nada de enums, parameter properties
 * ni `namespace` en `apps/api`. `import type` y tipos planos, y listo.
 */

import { leerConfig } from './config.ts'
import { crearPool } from './db.ts'
import { crearServidor } from './servidor.ts'

async function principal(): Promise<void> {
  const config = leerConfig(process.env)
  const pool = crearPool(config.databaseUrl)
  const app = crearServidor({ pool, logger: true })

  const cerrar = (): void => {
    void app
      .close()
      .then(() => pool.end())
      .then(() => process.exit(0))
  }
  process.on('SIGINT', cerrar)
  process.on('SIGTERM', cerrar)

  await app.listen({ port: config.port, host: '0.0.0.0' })
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
