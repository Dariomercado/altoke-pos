/**
 * Runner de migraciones en SQL plano (docs/specs/0003-api-y-sync.md §Infraestructura).
 *
 * Reglas que este archivo hace valer:
 *   - Los archivos se aplican en **orden de nombre de archivo**, uno por transacción, y cada uno
 *     queda registrado en `schema_migrations` en la misma transacción que su SQL.
 *   - Un advisory lock de Postgres impide que dos runners se intercalen: el segundo espera.
 *   - Una migración que falla se revierte entera y **no** se registra. Nada de estados a medias.
 *
 * El descubrimiento y el orden no tocan la base: se prueban sin Postgres.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FuenteDeConexiones } from './db.ts'

export const TABLA_MIGRACIONES = 'schema_migrations'

/** Clave del advisory lock: simbólica en SQL para no repartir números mágicos por el código. */
const CLAVE_ADVISORY_LOCK = 'altoke:migraciones'

export type Migracion = {
  readonly nombre: string
  readonly sql: string
}

export type ResumenMigraciones = {
  readonly aplicadas: readonly string[]
  readonly omitidas: readonly string[]
}

/** Los `.sql` del directorio en orden de nombre. Sin base de datos de por medio. */
export function descubrirMigraciones(directorio: string): string[] {
  return ordenarMigraciones(readdirSync(directorio))
}

/** Filtra lo que no es SQL y ordena por nombre. No muta la lista recibida. */
export function ordenarMigraciones(nombres: readonly string[]): string[] {
  return nombres
    .filter((nombre) => nombre.endsWith('.sql'))
    .sort((uno, otro) => (uno < otro ? -1 : uno > otro ? 1 : 0))
}

/** Nombre y contenido de cada migración, en el orden en que hay que aplicarlas. */
export function leerMigraciones(directorio: string): Migracion[] {
  return descubrirMigraciones(directorio).map((nombre) => ({
    nombre,
    sql: readFileSync(join(directorio, nombre), 'utf8'),
  }))
}

export async function aplicarMigraciones(
  pool: FuenteDeConexiones,
  migraciones: readonly Migracion[],
): Promise<ResumenMigraciones> {
  const conexion = await pool.connect()

  try {
    await conexion.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [CLAVE_ADVISORY_LOCK])
    await conexion.query(
      `CREATE TABLE IF NOT EXISTS ${TABLA_MIGRACIONES} (
        nombre text PRIMARY KEY,
        aplicado_en timestamptz NOT NULL DEFAULT now()
      )`,
    )

    const registradas = await conexion.query(`SELECT nombre FROM ${TABLA_MIGRACIONES}`)
    const yaAplicadas = new Set(registradas.rows.map((fila) => String(fila.nombre)))
    const aplicadas: string[] = []
    const omitidas: string[] = []

    for (const migracion of migraciones) {
      if (yaAplicadas.has(migracion.nombre)) {
        omitidas.push(migracion.nombre)
        continue
      }

      await conexion.query('BEGIN')
      try {
        await conexion.query(migracion.sql)
        await conexion.query(`INSERT INTO ${TABLA_MIGRACIONES} (nombre) VALUES ($1)`, [
          migracion.nombre,
        ])
        await conexion.query('COMMIT')
      } catch (error) {
        await conexion.query('ROLLBACK')
        throw error
      }

      aplicadas.push(migracion.nombre)
    }

    return { aplicadas, omitidas }
  } finally {
    try {
      await conexion.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [CLAVE_ADVISORY_LOCK])
    } catch {
      // La conexión ya no sirve: liberar el lock es tarea del servidor al cerrarla.
    }
    conexion.release()
  }
}
