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

/** La primera fila de un `RETURNING` que no puede volver vacío; si vuelve, es un error del código. */
export function primeraFila(resultado: ResultadoConsulta): Record<string, unknown> {
  const fila = resultado.rows[0]
  if (fila === undefined) throw new Error('la consulta no devolvió la fila esperada')
  return fila
}

/**
 * El nombre de la restricción de una violación de unicidad (`23505`), o `undefined` si el error no
 * lo es. El nombre es lo único que dice **qué** chocó: un `23505` sin traducir es un 500 por input
 * que el cliente puede corregir.
 */
export function restriccionUnica(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  if ((error as { code?: unknown }).code !== '23505') return undefined
  return String((error as { constraint?: unknown }).constraint ?? '')
}
