import { describe, expect, it } from 'vitest'
import { crearBaseDoble } from './dobles.ts'
import {
  HORAS_DE_SESION,
  buscarSesionActiva,
  esTokenConForma,
  generarToken,
  hashToken,
  insertarSesion,
  revocarSesion,
} from './sesiones.ts'

describe('tokens de sesión', () => {
  it('son 32 bytes aleatorios en base64url y no se repiten', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generarToken()))

    expect(tokens.size).toBe(100)
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    }
  })

  it('el servidor sólo puede guardar el SHA-256: el hash no contiene el token', () => {
    const token = generarToken()
    const hash = hashToken(token)

    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashToken(token))
    expect(hash).not.toContain(token)
  })

  it('rechaza tokens que no tienen la forma antes de ir a la base', () => {
    expect(esTokenConForma(generarToken())).toBe(true)
    for (const basura of ['', 'corto', generarToken() + 'x', 'a'.repeat(43) + '=', 'a b c']) {
      expect(esTokenConForma(basura), basura).toBe(false)
    }
  })
})

describe('sesiones contra la base', () => {
  it('inserta con vencimiento de 12 h y devuelve el ISO que calculó Postgres', async () => {
    const expira = new Date('2030-01-01T12:00:00.000Z')
    const doble = crearBaseDoble([{ sql: /^INSERT INTO sesiones/, filas: [{ expira_en: expira }] }])

    const expiraEn = await insertarSesion(doble.fuente, {
      tokenHash: 'hash',
      usuarioId: '00000000-0000-0000-0000-000000000001',
      tenantId: '00000000-0000-0000-0000-000000000002',
    })

    expect(expiraEn).toBe(expira.toISOString())
    expect(doble.consultas).toHaveLength(1)
    expect(doble.consultas[0]?.valores).toStrictEqual([
      'hash',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ])
  })

  it(`el vencimiento son ${HORAS_DE_SESION} horas y lo calcula el servidor`, async () => {
    const doble = crearBaseDoble([{ sql: /^INSERT INTO sesiones/, filas: [{ expira_en: '2030-01-01T00:00:00Z' }] }])

    await insertarSesion(doble.fuente, { tokenHash: 'h', usuarioId: 'u', tenantId: 't' })

    expect(doble.consultas[0]?.sql).toContain(`interval '${HORAS_DE_SESION} hours'`)
    expect(doble.consultas[0]?.sql).toContain('now()')
  })

  it('al buscar, vencida y revocada se filtran en el SQL: no hay token vencido que siga viajando', async () => {
    const doble = crearBaseDoble([
      {
        sql: /FROM sesiones/,
        filas: [{ usuario_id: 'u1', tenant_id: 't1', email: 'a@b.com', nombre: 'Ana' }],
      },
    ])

    const sesion = await buscarSesionActiva(doble.fuente, 'hash')

    expect(sesion).toStrictEqual({
      tokenHash: 'hash',
      usuarioId: 'u1',
      tenantId: 't1',
      email: 'a@b.com',
      nombre: 'Ana',
    })
    const sql = doble.consultas[0]?.sql ?? ''
    expect(sql).toContain('s.revocada_en IS NULL')
    expect(sql).toContain('s.expira_en > now()')
  })

  it('sin fila devuelve undefined', async () => {
    const doble = crearBaseDoble([{ sql: /FROM sesiones/, filas: [] }])
    await expect(buscarSesionActiva(doble.fuente, 'hash')).resolves.toBeUndefined()
  })

  it('revocar escribe revocada_en sólo si no estaba revocada', async () => {
    const doble = crearBaseDoble([{ sql: /^UPDATE sesiones SET revocada_en/, filas: [] }])

    await revocarSesion(doble.fuente, 'hash')

    const consulta = doble.consultas[0]
    expect(consulta?.sql).toContain('SET revocada_en = now()')
    expect(consulta?.sql).toContain('WHERE token_hash = $1 AND revocada_en IS NULL')
    expect(consulta?.valores).toStrictEqual(['hash'])
  })
})
