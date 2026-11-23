/**
 * Pool de `pg` y los tipos mínimos de base con los que habla el resto del paquete.
 *
 * Sin ORM (docs/specs/0003-api-y-sync.md §Infraestructura): el SQL es la fuente de verdad y RLS
 * se apoya en `SET LOCAL app.tenant_id`, que un ORM esconde.
 */

import { Pool } from 'pg'

/** Lo que devuelve una consulta: filas con nombres de columna, sin más. */
export type ResultadoConsulta = { readonly rows: readonly Record<string, unknown>[] }

/** Cualquier cosa que pueda correr SQL: el pool, una conexión o un doble de test. */
export type Consultable = {
  query(consulta: string, valores?: readonly unknown[]): Promise<ResultadoConsulta>
}

/** Conexión dedicada: la que necesita una transacción o un advisory lock. */
export type Conexion = Consultable & { release(): void }

/** Origen de conexiones: el pool real, o un doble en los tests. */
export type FuenteDeConexiones = Consultable & {
  connect(): Promise<Conexion>
  end(): Promise<void>
}

export function crearPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl })
}
