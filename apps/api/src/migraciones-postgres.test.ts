/**
 * Migraciones contra un Postgres real.
 *
 * Corren como **dueño** (`MIGRATIONS_DATABASE_URL`, o `DATABASE_URL` si aquella falta): crear
 * tablas y políticas es DDL y el rol de la API no la tiene. Apuntan a la base de docker-compose
 * (ver README de apps/api). Si la variable falta, la suite se **omite con un aviso explícito**:
 * omitir no es pasar.
 */
import { describe, expect, it } from 'vitest'
import { crearPool } from './db.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'
import type { FuenteDeConexiones } from './db.ts'
import type { Migracion } from './migraciones.ts'

const databaseUrl = (process.env.MIGRATIONS_DATABASE_URL ?? process.env.DATABASE_URL)?.trim()
const sinBase = databaseUrl === undefined || databaseUrl === ''

if (sinBase) {
  // `process.stderr.write` y no `console.warn`: en un archivo enteramente omitido, vitest se come
  // la consola capturada. El aviso tiene que verse en la salida de `pnpm test`.
  process.stderr.write(
    '[apps/api] DATABASE_URL ausente: se OMITEN los tests del runner contra Postgres (2 tests). ' +
      'Para correrlos: pnpm db:up y después ' +
      'DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke ' +
      'MIGRATIONS_DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm test.\n',
  )
}

const DIRECTORIO_MIGRACIONES = `${import.meta.dirname}/../migrations`

function poolDePrueba(): FuenteDeConexiones {
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('sin DATABASE_URL no hay pool (esta rama la evita describe.skipIf)')
  }
  return crearPool(databaseUrl)
}

const MIGRACION_ROTA: Migracion = {
  nombre: '9999_rota.sql',
  sql: 'CREATE TABLE migracion_rota (id int); ESTO NO ES SQL;',
}

describe.skipIf(sinBase)('aplicarMigraciones contra Postgres', () => {
  it('aplica el esquema y es idempotente: la segunda corrida no reaplica nada ni duplica filas', async () => {
    const migraciones = leerMigraciones(DIRECTORIO_MIGRACIONES)
    expect(migraciones.length).toBeGreaterThan(0)
    const pool = poolDePrueba()

    try {
      await aplicarMigraciones(pool, migraciones)
      const segunda = await aplicarMigraciones(pool, migraciones)

      expect(segunda.aplicadas).toStrictEqual([])
      expect(segunda.omitidas).toStrictEqual(migraciones.map((migracion) => migracion.nombre))

      const filas = await pool.query('SELECT nombre FROM schema_migrations ORDER BY nombre')
      expect(filas.rows.map((fila) => fila.nombre)).toStrictEqual(
        migraciones.map((migracion) => migracion.nombre),
      )
    } finally {
      await pool.end()
    }
  })

  it('revierte una migración que falla y no la registra', async () => {
    const pool = poolDePrueba()

    try {
      const antes = await pool.query('SELECT count(*)::int AS total FROM schema_migrations')

      await expect(aplicarMigraciones(pool, [MIGRACION_ROTA])).rejects.toThrow()

      const despues = await pool.query('SELECT count(*)::int AS total FROM schema_migrations')
      expect(despues.rows[0]?.total).toBe(antes.rows[0]?.total)

      const tabla = await pool.query(`SELECT to_regclass('migracion_rota') AS existe`)
      expect(tabla.rows[0]?.existe).toBeNull()
    } finally {
      await pool.end()
    }
  })
})
