import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import {
  ErrorApi,
  MENSAJE_SIN_SESION,
  noAutenticado,
  registrarManejadoresDeError,
  sinPermiso,
  tenantDesconocido,
  validacion,
} from './errores.ts'

describe('ErrorApi', () => {
  it('lleva código, estado, mensaje y detalle opcional', () => {
    const error = validacion('El email no es válido.', 'email')
    expect(error).toBeInstanceOf(ErrorApi)
    expect(error.codigo).toBe('validacion')
    expect(error.estado).toBe(400)
    expect(error.detalle).toStrictEqual({ campo: 'email' })

    expect(noAutenticado().estado).toBe(401)
    expect(noAutenticado().message).toBe(MENSAJE_SIN_SESION)
    expect(sinPermiso().estado).toBe(403)
    expect(tenantDesconocido().codigo).toBe('tenant_desconocido')
  })
})

async function servidorCon(error: unknown) {
  const app = Fastify({ logger: false })
  registrarManejadoresDeError(app)
  app.get('/romper', async () => {
    throw error
  })
  return app
}

describe('forma única de error', () => {
  it('un ErrorApi sale con { error: { code, mensaje, detalle } }', async () => {
    const app = await servidorCon(validacion('El slug ya existe.', 'tenant.slug'))

    const respuesta = await app.inject({ method: 'GET', url: '/romper' })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: 'El slug ya existe.', detalle: { campo: 'tenant.slug' } },
    })
    await app.close()
  })

  it('sin detalle la clave no aparece: la forma no cambia, el ruido no viaja', async () => {
    const app = await servidorCon(noAutenticado())

    const respuesta = await app.inject({ method: 'GET', url: '/romper' })

    expect(respuesta.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: MENSAJE_SIN_SESION },
    })
    await app.close()
  })

  it('un error inesperado es 500 con la misma forma y sin stack ni detalle interno', async () => {
    const app = await servidorCon(new Error('database connection lost: password=super-secreta'))

    const respuesta = await app.inject({ method: 'GET', url: '/romper' })
    const cuerpo = respuesta.body

    expect(respuesta.statusCode).toBe(500)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'error_interno', mensaje: 'Error interno.' },
    })
    expect(cuerpo).not.toContain('database connection lost')
    expect(cuerpo).not.toContain('super-secreta')
    expect(cuerpo).not.toContain('at ')
    await app.close()
  })

  it('una ruta inexistente también responde con la forma común', async () => {
    const app = Fastify({ logger: false })
    registrarManejadoresDeError(app)

    const respuesta = await app.inject({ method: 'GET', url: '/no-existe' })

    expect(respuesta.statusCode).toBe(404)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'no_encontrado', mensaje: 'Esa ruta no existe.' },
    })
    await app.close()
  })

  it('un JSON malformado es validacion, no el 400 por defecto de Fastify', async () => {
    const app = Fastify({ logger: false })
    registrarManejadoresDeError(app)
    app.post('/algo', async () => ({ ok: true }))

    const respuesta = await app.inject({
      method: 'POST',
      url: '/algo',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: 'El pedido no se pudo leer.' },
    })
    await app.close()
  })
})
