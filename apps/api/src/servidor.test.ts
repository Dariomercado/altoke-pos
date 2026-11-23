import { describe, expect, it } from 'vitest'
import { crearServidor } from './servidor.ts'

describe('GET /salud', () => {
  it('responde 200 con db up cuando el pool contesta', async () => {
    const consultas: string[] = []
    const app = crearServidor({
      pool: {
        query: async (consulta) => {
          consultas.push(consulta)
          return { rows: [{ '?column?': 1 }] }
        },
        connect: async () => {
          throw new Error('GET /salud no necesita una conexión dedicada')
        },
        end: async () => {},
      },
    })

    const respuesta = await app.inject({ method: 'GET', url: '/salud' })
    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json()).toStrictEqual({ ok: true, db: 'up' })
    expect(consultas).toStrictEqual(['SELECT 1'])
    await app.close()
  })

  it('responde 200 con db down cuando la base no está: un health check que miente es peor que ninguno', async () => {
    const app = crearServidor({
      pool: {
        query: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:5435')
        },
        connect: async () => {
          throw new Error('GET /salud no necesita una conexión dedicada')
        },
        end: async () => {},
      },
    })

    const respuesta = await app.inject({ method: 'GET', url: '/salud' })
    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json()).toStrictEqual({ ok: true, db: 'down' })
    await app.close()
  })
})

/**
 * CORS explícito (`docs/specs/0003-api-y-sync.md` §Infraestructura): sólo los orígenes de tenant
 * declarados, con credenciales, y `*` nunca.
 */
describe('CORS', () => {
  const ORIGEN = 'https://kiosco.altoke.app'
  const AJENO = 'https://evil.example'

  function crearApp(): ReturnType<typeof crearServidor> {
    return crearServidor({
      pool: {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
        connect: async () => {
          throw new Error('CORS no necesita una conexión dedicada')
        },
        end: async () => {},
      },
      origenesPermitidos: [ORIGEN],
    })
  }

  it('un origen declarado pasa, con su ACAO exacto, credenciales y Vary', async () => {
    const app = crearApp()

    const respuesta = await app.inject({
      method: 'GET',
      url: '/salud',
      headers: { origin: ORIGEN },
    })

    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN)
    expect(respuesta.headers['access-control-allow-credentials']).toBe('true')
    expect(String(respuesta.headers['vary'])).toContain('Origin')
    await app.close()
  })

  it('un origen desconocido se rechaza con 403 sin_permiso y sin ACAO', async () => {
    const app = crearApp()

    const respuesta = await app.inject({
      method: 'GET',
      url: '/salud',
      headers: { origin: AJENO },
    })

    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: expect.any(String) },
    })
    // Rechazar no es reflejar: el navegador no puede leer la respuesta como autorizada.
    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined()
    await app.close()
  })

  it('nunca emite `*`, ni en el origen permitido ni en el rechazado', async () => {
    const app = crearApp()

    const permitida = await app.inject({
      method: 'GET',
      url: '/salud',
      headers: { origin: ORIGEN },
    })
    const ajena = await app.inject({
      method: 'GET',
      url: '/salud',
      headers: { origin: AJENO },
    })

    for (const respuesta of [permitida, ajena]) {
      expect(respuesta.headers['access-control-allow-origin']).not.toBe('*')
      expect(Object.values(respuesta.headers).map(String).some((valor) => valor.includes('*'))).toBe(
        false,
      )
    }
    await app.close()
  })

  it('el preflight de un origen declarado responde 204 y acepta X-Tenant', async () => {
    const app = crearApp()

    const respuesta = await app.inject({
      method: 'OPTIONS',
      url: '/sync/eventos',
      headers: {
        origin: ORIGEN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type, x-tenant',
      },
    })

    expect(respuesta.statusCode).toBe(204)
    expect(respuesta.headers['access-control-allow-origin']).toBe(ORIGEN)
    expect(respuesta.headers['access-control-allow-credentials']).toBe('true')
    expect(String(respuesta.headers['access-control-allow-methods'])).toContain('POST')
    expect(String(respuesta.headers['access-control-allow-headers'])).toContain('X-Tenant')
    expect(String(respuesta.headers['access-control-allow-headers'])).toContain('Authorization')
    await app.close()
  })
})
