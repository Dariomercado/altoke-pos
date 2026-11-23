/**
 * Doble de base para los tests que no pueden (ni necesitan) un Postgres.
 *
 * No pretende ser un SQL engine: devuelve filas guionadas por una regex sobre la consulta
 * normalizada y **registra todo** lo que se ejecutó, con el id de la conexión. Eso permite
 * verificar lo que de verdad importa sin base: que `BEGIN`/`set_config('app.tenant_id', ..., true)`/
 * `COMMIT` pasan por la **misma** conexión y que la conexión se libera al final (0003 §Esquema).
 */

import type { Conexion, FuenteDeConexiones, ResultadoConsulta } from './db.ts'

export type Regla = {
  readonly sql: RegExp
  readonly filas?: readonly Record<string, unknown>[]
  /** Si está, la consulta falla con este error (para simular una violación de unicidad). */
  readonly error?: unknown
}

export type ConsultaRegistrada = {
  readonly conexion: number
  readonly sql: string
  readonly valores: readonly unknown[]
}

export type BaseDoble = {
  readonly fuente: FuenteDeConexiones
  readonly consultas: ConsultaRegistrada[]
  readonly liberadas: number[]
}

function normalizar(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

export function crearBaseDoble(reglas: readonly Regla[] = []): BaseDoble {
  const consultas: ConsultaRegistrada[] = []
  const liberadas: number[] = []
  let siguienteConexion = 1

  function reglaPara(sql: string): Regla | undefined {
    const normal = normalizar(sql)
    return reglas.find((regla) => regla.sql.test(normal))
  }

  async function ejecutar(
    conexion: number,
    sql: string,
    valores: readonly unknown[] = [],
  ): Promise<ResultadoConsulta> {
    consultas.push({ conexion, sql: normalizar(sql), valores })
    const regla = reglaPara(sql)
    if (regla?.error !== undefined) throw regla.error
    return { rows: regla?.filas ?? [] }
  }

  function conexionDoble(id: number): Conexion {
    return {
      query: (sql: string, valores?: readonly unknown[]) => ejecutar(id, sql, valores),
      release: () => {
        liberadas.push(id)
      },
    }
  }

  const fuente: FuenteDeConexiones = {
    query: (sql: string, valores?: readonly unknown[]) => ejecutar(0, sql, valores),
    connect: async () => conexionDoble(siguienteConexion++),
    end: async () => {},
  }

  return { fuente, consultas, liberadas }
}

/** Las consultas de una conexión, en orden: sirve para mirar la transacción completa. */
export function deLaConexion(consultas: readonly ConsultaRegistrada[], conexion: number): string[] {
  return consultas.filter((consulta) => consulta.conexion === conexion).map((c) => c.sql)
}

export const SQL_BEGIN = /^BEGIN$/
export const SQL_COMMIT = /^COMMIT$/
export const SQL_ROLLBACK = /^ROLLBACK$/
export const SQL_TENANT = /^SELECT set_config\(\$1, \$2, true\)$/
