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
