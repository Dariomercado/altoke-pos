/**
 * RLS de verdad, contra un Postgres real y con **dos roles**.
 *
 * Postgres no aplica RLS al dueño de la tabla: si la API se conectara con el rol que corre las
 * migraciones, el aislamiento por tenant sería decorativo. Este archivo lo prueba con las dos
 * conexiones del docker-compose local:
 *
 *   - `MIGRATIONS_DATABASE_URL` (o `DATABASE_URL` si falta): el dueño, sólo para migrar y sembrar.
 *   - `DATABASE_URL`: `altoke_app`, el rol con el que la API atiende. No es dueño y no tiene DDL.
 *
 * Sin `DATABASE_URL` la suite se **omite con un aviso explícito**: omitir no es pasar.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearPool } from './db.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'
import type { FuenteDeConexiones } from './db.ts'

const DIRECTORIO_MIGRACIONES = `${import.meta.dirname}/../migrations`

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}

const urlApp = texto(process.env.DATABASE_URL)
const urlDuenio = texto(process.env.MIGRATIONS_DATABASE_URL) ?? urlApp
const sinBase = urlApp === undefined || urlDuenio === undefined

if (sinBase) {
  process.stderr.write(
    '[apps/api] DATABASE_URL ausente: se OMITEN los tests de RLS (3 tests). ' +
      'Para correrlos: pnpm db:up y después ' +
      'DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke ' +
      'MIGRATIONS_DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm test.\n',
  )
}

type Semilla = {
  readonly tenantA: string
  readonly tenantB: string
  readonly eventoA: string
  readonly eventoB: string
}

describe.skipIf(sinBase)('RLS por app.tenant_id', () => {
  let duenio: FuenteDeConexiones
  let app: FuenteDeConexiones

  beforeAll(async () => {
    // Primero el dueño: crea el esquema, el rol de la API y sus grants. Después la API puede
    // conectarse (en una base recién creada el rol todavía no existe).
    duenio = crearPool(urlDuenio as string)
    await aplicarMigraciones(duenio, leerMigraciones(DIRECTORIO_MIGRACIONES))
    app = crearPool(urlApp as string)
  })

  afterAll(async () => {
    await app.end()
    await duenio.end()
  })

  it('el rol de la API no es dueño de nada y no puede hacer DDL', async () => {
    const conexion = await app.connect()

    try {
      const fila = await conexion.query(
        `SELECT current_user AS usuario,
                (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superusuario,
                (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS salta_rls,
                (SELECT tableowner FROM pg_tables
                  WHERE schemaname = 'public' AND tablename = 'eventos') AS duenio_eventos`,
      )
      const identidad = fila.rows[0]

      expect(String(identidad?.['usuario'])).not.toBe(String(identidad?.['duenio_eventos']))
      expect(identidad?.['superusuario']).toBe(false)
      expect(identidad?.['salta_rls']).toBe(false)

      await expect(
        conexion.query('CREATE TABLE rls_ddl_prohibido (id int)'),
        'altoke_app no puede crear tablas: no tiene DDL',
      ).rejects.toThrow()
    } finally {
      conexion.release()
    }

    const tabla = await duenio.query(`SELECT to_regclass('public.rls_ddl_prohibido') AS existe`)
    expect(tabla.rows[0]?.['existe']).toBeNull()
  })

  it('sin app.tenant_id no ve ni una fila: falla cerrada en 0, no en error', async () => {
    const semilla = await sembrarDosTenants(duenio)

    try {
      const comoDuenio = await duenio.query(
        'SELECT count(*)::int AS total FROM eventos WHERE tenant_id = ANY($1::uuid[])',
        [[semilla.tenantA, semilla.tenantB]],
      )
      expect(comoDuenio.rows[0]?.['total'], 'el dueño sí ve los dos eventos sembrados').toBe(2)

      const conexion = await app.connect()
      try {
        const visible = await conexion.query('SELECT count(*)::int AS total FROM eventos')
        expect(visible.rows[0]?.['total'], 'sin tenant seteado la respuesta es 0, no un error').toBe(0)
      } finally {
        conexion.release()
      }
    } finally {
      await limpiar(duenio, semilla)
    }
  })

  it('con app.tenant_id ve su tenant y nada del otro', async () => {
    const semilla = await sembrarDosTenants(duenio)

    try {
      for (const [propio, ajeno, eventoPropio, eventoAjeno] of [
        [semilla.tenantA, semilla.tenantB, semilla.eventoA, semilla.eventoB],
        [semilla.tenantB, semilla.tenantA, semilla.eventoB, semilla.eventoA],
      ] as const) {
        const conexion = await app.connect()
        try {
          await conexion.query('BEGIN')
          await conexion.query('SELECT set_config($1, $2, true)', ['app.tenant_id', propio])

          const filas = await conexion.query('SELECT id, tenant_id FROM eventos')
          expect(filas.rows.length, `${propio} tiene al menos un evento visible`).toBeGreaterThan(0)
          expect(
            filas.rows.every((fila) => String(fila['tenant_id']) === propio),
            `ninguna fila de ${ajeno} se cuela en ${propio}`,
          ).toBe(true)

          const ids = filas.rows.map((fila) => String(fila['id']))
          expect(ids).toContain(eventoPropio)
          expect(ids).not.toContain(eventoAjeno)

          // Ni siquiera nombrando el evento del otro tenant por id se lo puede ver.
          const ajenoPorId = await conexion.query('SELECT count(*)::int AS total FROM eventos WHERE id = $1', [
            eventoAjeno,
          ])
          expect(ajenoPorId.rows[0]?.['total']).toBe(0)
        } finally {
          await conexion.query('ROLLBACK')
          conexion.release()
        }
      }
    } finally {
      await limpiar(duenio, semilla)
    }
  })
})

/** Dos tenants con un evento cada uno. Como dueño: RLS no lo alcanza. */
async function sembrarDosTenants(duenio: FuenteDeConexiones): Promise<Semilla> {
  const semilla: Semilla = {
    tenantA: randomUUID(),
    tenantB: randomUUID(),
    eventoA: randomUUID(),
    eventoB: randomUUID(),
  }

  await duenio.query(
    `INSERT INTO tenants (id, slug, nombre)
     VALUES ($1, $2, 'Tenant A'), ($3, $4, 'Tenant B')`,
    [semilla.tenantA, `rls-a-${semilla.tenantA}`, semilla.tenantB, `rls-b-${semilla.tenantB}`],
  )
  await duenio.query(
    `INSERT INTO eventos (id, tenant_id, terminal_id, secuencia, tipo, ocurrido_en, schema_version, cuerpo)
     VALUES ($1, $2, $3, 1, 'venta', now(), 1, '{}'::jsonb),
            ($4, $5, $6, 1, 'venta', now(), 1, '{}'::jsonb)`,
    [semilla.eventoA, semilla.tenantA, `terminal-a-${semilla.tenantA}`, semilla.eventoB, semilla.tenantB, `terminal-b-${semilla.tenantB}`],
  )

  return semilla
}

/** Borra lo sembrado (`eventos` cae por cascada). El test no deja filas atrás. */
async function limpiar(duenio: FuenteDeConexiones, semilla: Semilla): Promise<void> {
  await duenio.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [
    [semilla.tenantA, semilla.tenantB],
  ])
}
