/**
 * El savepoint de `asegurarSucursal` sin Postgres: lo observable no es el SQL por el SQL, es que la
 * transacción quede como estaba. Un `SAVEPOINT` sin `RELEASE` deja abierta una subtramo que nadie
 * va a cerrar, y es el tipo de fuga que sólo se nota cuando la transacción ya es larga.
 */

import { describe, expect, it } from 'vitest'
import type { Consultable } from './db.ts'
import { asegurarSucursal } from './tenants.ts'

type Respuesta =
  | { readonly filas: readonly Record<string, unknown>[] }
  | { readonly error: unknown }

/** Las sentencias de control del savepoint no son datos: se registran y se dejan pasar. */
const CONTROL = /^(?:SAVEPOINT|RELEASE|ROLLBACK)\b/

/** Una conexión con el guion puesto: cada `query` de datos consume la siguiente respuesta, en orden. */
function conexionGuionada(respuestas: readonly Respuesta[]): {
  readonly consultable: Consultable
  readonly sqls: string[]
} {
  const sqls: string[] = []
  let siguiente = 0

  const consultable: Consultable = {
    query: async (sql: string) => {
      sqls.push(sql)
      if (CONTROL.test(sql)) return { rows: [] }

      const respuesta = respuestas[siguiente++]
      if (respuesta === undefined) throw new Error(`consulta inesperada: ${sql}`)
      if ('error' in respuesta) throw respuesta.error
      return { rows: respuesta.filas }
    },
  }

  return { consultable, sqls }
}

function violacionDeUnicidad(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint: 'sucursales_tenant_nombre_unico',
  })
}

const SAVEPOINT = 'SAVEPOINT sucursal'
const RELEASE = 'RELEASE SAVEPOINT sucursal'
const ROLLBACK = 'ROLLBACK TO SAVEPOINT sucursal'

describe('asegurarSucursal', () => {
  it('crea la sucursal y libera el savepoint', async () => {
    const { consultable, sqls } = conexionGuionada([
      { filas: [] },
      { filas: [{ id: 'suc-1', nombre: 'Nueva' }] },
    ])

    await expect(asegurarSucursal(consultable, 'tenant-1', 'Nueva')).resolves.toEqual({
      id: 'suc-1',
      nombre: 'Nueva',
    })

    expect(sqls.filter((sql) => sql.startsWith('SAVEPOINT') || sql.startsWith('RELEASE'))).toEqual([
      SAVEPOINT,
      RELEASE,
    ])
    expect(sqls.at(-1)).toBe(RELEASE)
  })

  it('libera el savepoint también cuando la sucursal la creó otro pedido', async () => {
    const { consultable, sqls } = conexionGuionada([
      { filas: [] },
      { error: violacionDeUnicidad() },
      { filas: [{ id: 'suc-2', nombre: 'Nueva' }] },
    ])

    await expect(asegurarSucursal(consultable, 'tenant-1', 'Nueva')).resolves.toEqual({
      id: 'suc-2',
      nombre: 'Nueva',
    })

    expect(sqls.filter((sql) => sql.startsWith('ROLLBACK') || sql.startsWith('RELEASE'))).toEqual([
      ROLLBACK,
      RELEASE,
    ])
    expect(sqls.at(-1)).toBe(RELEASE)
  })

  it('no toca el savepoint si la sucursal ya existía', async () => {
    const { consultable, sqls } = conexionGuionada([
      { filas: [{ id: 'suc-3', nombre: 'Nueva' }] },
    ])

    await expect(asegurarSucursal(consultable, 'tenant-1', 'Nueva')).resolves.toEqual({
      id: 'suc-3',
      nombre: 'Nueva',
    })

    expect(sqls).toHaveLength(1)
  })
})
