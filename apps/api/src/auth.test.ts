/**
 * El middleware de sesión, tenant y rol contra el doble de base.
 *
 * Lo que no se puede probar sin Postgres (un tenant que RLS esconde de verdad) está en
 * `auth-postgres.test.ts`. Acá se prueba lo que sí: la forma de los errores, que un token de un
 * tenant no alcanza a otro, que el rol se chequea antes de tocar nada y que `app.tenant_id` se
 * setea en la misma conexión que corre la consulta.
 */

import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import { autenticacionDe, leerBearer, requiereAlMenos, requiereRol } from './auth.ts'
import type { Autenticacion } from './auth.ts'
import { crearBaseDoble, deLaConexion } from './dobles.ts'
import type { Regla } from './dobles.ts'
import { registrarManejadoresDeError } from './errores.ts'
import { crearServidor } from './servidor.ts'
import { generarToken, hashToken } from './sesiones.ts'

const USUARIO_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_A = { id: '22222222-2222-2222-2222-222222222222', slug: 'kiosco-a', nombre: 'Kiosco A' }
const TENANT_B = { id: '33333333-3333-3333-3333-333333333333', slug: 'kiosco-b', nombre: 'Kiosco B' }

const TOKEN = generarToken()
const SESION = {
  usuario_id: USUARIO_ID,
  tenant_id: TENANT_A.id,
  email: 'ana@kiosco.com',
  nombre: 'Ana',
}

function membresia(tenant: { id: string; slug: string; nombre: string }, rol: string) {
  return { tenant_id: tenant.id, rol, slug: tenant.slug, nombre: tenant.nombre }
}

/** Las cuatro consultas del camino autenticado, con el tenant y el rol que pida cada test. */
function reglasBase(
  opciones: {
    readonly rol?: string
    readonly tenant?: { id: string; slug: string; nombre: string }
    readonly membresias?: readonly Record<string, unknown>[]
    readonly membresiaBuscada?: readonly Record<string, unknown>[]
  } = {},
): Regla[] {
  const tenant = opciones.tenant ?? TENANT_A
  const rol = opciones.rol ?? 'owner'
  return [
    { sql: /FROM sesiones/, filas: [{ ...SESION, tenant_id: tenant.id }] },
    {
      sql: /FROM membresias WHERE usuario_id = \$1 AND tenant_id = \$2/,
      filas: opciones.membresiaBuscada ?? [{ rol }],
    },
    { sql: /FROM tenants WHERE slug/, filas: [tenant] },
    {
      sql: /FROM membresias m JOIN tenants/,
      filas: opciones.membresias ?? [membresia(tenant, rol)],
    },
  ]
}

function servidor(reglas: readonly Regla[]): {
  readonly app: FastifyInstance
  readonly doble: ReturnType<typeof crearBaseDoble>
} {
  const doble = crearBaseDoble(reglas)
  return { app: crearServidor({ pool: doble.fuente }), doble }
}

function conToken(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${TOKEN}`, ...extra }
}

describe('leerBearer', () => {
  it('acepta el esquema en cualquier capitalización y exige un solo token', () => {
    expect(leerBearer('Bearer abc')).toBe('abc')
    expect(leerBearer('bearer abc')).toBe('abc')
    expect(leerBearer('  BEARER   abc  ')).toBe('abc')
    expect(leerBearer(undefined)).toBeUndefined()
    expect(leerBearer('Basic abc')).toBeUndefined()
    expect(leerBearer('Bearer')).toBeUndefined()
    expect(leerBearer('Bearer a b')).toBeUndefined()
  })
})

describe('autenticar', () => {
  it('sin Authorization no consulta la base y responde no_autenticado', async () => {
    const { app, doble } = servidor(reglasBase())

    const respuesta = await app.inject({ method: 'GET', url: '/auth/yo' })

    expect(respuesta.statusCode).toBe(401)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })
    expect(doble.consultas).toStrictEqual([])
    await app.close()
  })

  it('un token con forma inválida tampoco llega a la base', async () => {
    const { app, doble } = servidor(reglasBase())

    const respuesta = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: { authorization: 'Bearer no-es-un-token' },
    })

    expect(respuesta.statusCode).toBe(401)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })
    expect(doble.consultas).toStrictEqual([])
    await app.close()
  })

  it('un token desconocido, vencido o revocado es el mismo no_autenticado', async () => {
    const { app } = servidor([{ sql: /FROM sesiones/, filas: [] }])

    const respuesta = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: { authorization: `Bearer ${generarToken()}` },
    })

    expect(respuesta.statusCode).toBe(401)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })
    await app.close()
  })

  it('busca la sesión por SHA-256, nunca por el token en claro', async () => {
    const { app, doble } = servidor(reglasBase())

    await app.inject({ method: 'GET', url: '/auth/yo', headers: conToken() })

    const consultaSesion = doble.consultas.find((consulta) => /FROM sesiones/.test(consulta.sql))
    expect(consultaSesion?.valores).toStrictEqual([hashToken(TOKEN)])
    expect(consultaSesion?.valores).not.toContain(TOKEN)
    await app.close()
  })

  it('con una sola membresía elige ese tenant y setea app.tenant_id en la conexión que consulta', async () => {
    const { app, doble } = servidor(reglasBase())

    const respuesta = await app.inject({ method: 'GET', url: '/auth/yo', headers: conToken() })

    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json()).toStrictEqual({
      usuario: { id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana' },
      membresias: [
        { tenantId: TENANT_A.id, slug: 'kiosco-a', nombre: 'Kiosco A', rol: 'owner' },
      ],
    })

    const conexiones = [...new Set(doble.consultas.map((c) => c.conexion))].filter((id) => id !== 0)
    expect(conexiones.length).toBeGreaterThan(1)
    for (const id of conexiones) {
      const sqls = deLaConexion(doble.consultas, id)
      expect(sqls[0]).toBe('BEGIN')
      expect(sqls.at(-1)).toBe('COMMIT')
    }
    // El set_config de usuario viaja en la misma conexión de la transacción, con el valor de la
    // sesión, jamás con algo que mande el cliente.
    const configuraciones = doble.consultas.filter((c) =>
      c.sql.startsWith('SELECT set_config'),
    )
    expect(configuraciones.length).toBeGreaterThan(0)
    for (const configuracion of configuraciones) {
      expect(configuracion.valores).toStrictEqual(['app.usuario_id', USUARIO_ID])
      expect(configuracion.conexion).not.toBe(0)
    }
    expect(doble.liberadas).toStrictEqual(conexiones)
    await app.close()
  })

  it('con X-Tenant elige ese tenant y valida la membresía con app.tenant_id en la transacción', async () => {
    const { app, doble } = servidor(reglasBase({ tenant: TENANT_B }))

    const respuesta = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: conToken({ 'x-tenant': 'kiosco-b' }),
    })

    expect(respuesta.statusCode).toBe(200)
    const configuraciones = doble.consultas.filter((c) => c.sql.startsWith('SELECT set_config'))
    expect(configuraciones[0]?.valores).toStrictEqual(['app.tenant_id', TENANT_B.id])
    expect(configuraciones[0]?.conexion).not.toBe(0)
    await app.close()
  })

  it('un X-Tenant que no existe es tenant_desconocido, no un vacío que parece éxito', async () => {
    const { app } = servidor([
      { sql: /FROM sesiones/, filas: [SESION] },
      { sql: /FROM tenants WHERE slug/, filas: [] },
    ])

    const respuesta = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: conToken({ 'x-tenant': 'no-existe' }),
    })

    expect(respuesta.statusCode).toBe(404)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'tenant_desconocido', mensaje: 'Ese tenant no existe.' },
    })
    await app.close()
  })

  it('pedir un tenant del que no se es miembro es sin_permiso, nunca 0 filas', async () => {
    const { app, doble } = servidor(reglasBase({ tenant: TENANT_B, membresiaBuscada: [] }))

    const respuesta = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: conToken({ 'x-tenant': 'kiosco-b' }),
    })

    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'No tenés permiso para ese tenant.' },
    })
    expect(doble.consultas.some((consulta) => /FROM membresias m JOIN tenants/.test(consulta.sql))).toBe(
      false,
    )
    await app.close()
  })

  it('con más de un tenant y sin X-Tenant no elige al azar: pide el encabezado', async () => {
    const { app } = servidor(
      reglasBase({ membresias: [membresia(TENANT_A, 'owner'), membresia(TENANT_B, 'cajero')] }),
    )

    const respuesta = await app.inject({ method: 'GET', url: '/auth/yo', headers: conToken() })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: 'Tenés más de un tenant: mandá X-Tenant con el slug.',
        detalle: { campo: 'X-Tenant' },
      },
    })
    await app.close()
  })

  it('un usuario sin membresías no entra a ningún lado', async () => {
    const { app } = servidor(reglasBase({ membresias: [] }))

    const respuesta = await app.inject({ method: 'GET', url: '/auth/yo', headers: conToken() })

    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'Tu cuenta no pertenece a ningún tenant.' },
    })
    await app.close()
  })
})

describe('guardas de rol', () => {
  const autenticacion: Autenticacion = {
    usuarioId: USUARIO_ID,
    email: 'ana@kiosco.com',
    nombre: 'Ana',
    tenantId: TENANT_A.id,
    rol: 'owner',
    tokenHash: 'hash',
  }

  function appConGuarda(
    guarda: ReturnType<typeof requiereRol> | ReturnType<typeof requiereAlMenos>,
    rol?: Autenticacion['rol'],
  ): FastifyInstance {
    const app = Fastify({ logger: false })
    registrarManejadoresDeError(app)
    app.addHook('preHandler', async (request) => {
      request.autenticacion = { ...autenticacion, rol: rol ?? autenticacion.rol }
    })
    app.get('/recurso', { preHandler: guarda }, async () => ({ ok: true }))
    return app
  }

  it('requiereRol deja pasar sólo a los roles listados', async () => {
    for (const [rol, esperado] of [
      ['owner', 200],
      ['admin', 200],
      ['cajero', 403],
      ['solo_lectura', 403],
    ] as const) {
      const app = appConGuarda(requiereRol('owner', 'admin'), rol)
      const respuesta = await app.inject({ method: 'GET', url: '/recurso' })
      expect(respuesta.statusCode, rol).toBe(esperado)
      await app.close()
    }
  })

  it('requiereAlMenos respeta el orden: cajero sí, solo_lectura no', async () => {
    for (const [rol, esperado] of [
      ['owner', 200],
      ['admin', 200],
      ['cajero', 200],
      ['solo_lectura', 403],
    ] as const) {
      const app = appConGuarda(requiereAlMenos('cajero'), rol)
      const respuesta = await app.inject({ method: 'GET', url: '/recurso' })
      expect(respuesta.statusCode, rol).toBe(esperado)
      await app.close()
    }
  })

  it('el rechazo tiene la forma común de sin_permiso', async () => {
    const app = appConGuarda(requiereAlMenos('cajero'), 'solo_lectura')
    const respuesta = await app.inject({ method: 'GET', url: '/recurso' })

    expect(respuesta.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'No tenés permiso para esta acción.' },
    })
    await app.close()
  })

  it('sin autenticación la guarda no deja pasar: no confía en el orden de los hooks', async () => {
    const app = Fastify({ logger: false })
    registrarManejadoresDeError(app)
    app.get('/recurso', { preHandler: requiereRol('owner') }, async () => ({ ok: true }))

    const respuesta = await app.inject({ method: 'GET', url: '/recurso' })

    expect(respuesta.statusCode).toBe(401)
    await app.close()
  })
})

describe('autenticacionDe', () => {
  it('sin autenticación es no_autenticado, no un TypeError', async () => {
    const app = Fastify({ logger: false })
    registrarManejadoresDeError(app)
    app.get('/x', async (request) => autenticacionDe(request))

    const respuesta = await app.inject({ method: 'GET', url: '/x' })
    expect(respuesta.statusCode).toBe(401)
    await app.close()
  })
})
