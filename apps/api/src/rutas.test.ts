/**
 * Registro, login, `yo`, revocación, terminales y reset de contraseña contra el doble de base.
 *
 * La semántica real (una transacción que no deja huérfanos, RLS con dos roles, un token vencido que
 * la base rechaza) está en `auth-postgres.test.ts`. Acá se prueban la forma de la respuesta, el
 * orden de la transacción y los errores que el cliente ve.
 */

import { describe, expect, it } from 'vitest'
import { crearBaseDoble, deLaConexion } from './dobles.ts'
import type { Regla } from './dobles.ts'
import { MENSAJE_EMAIL_OCUPADO, MENSAJE_SLUG_OCUPADO } from './rutas-auth.ts'
import { MENSAJE_USUARIO_AJENO } from './rutas-tenants.ts'
import { crearServidor } from './servidor.ts'
import { hashPassword } from './password.ts'
import { generarToken } from './sesiones.ts'

const USUARIO_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = '22222222-2222-2222-2222-222222222222'
const TENANT_B_ID = '33333333-3333-3333-3333-333333333333'
const TOKEN = generarToken()

const TENANT = { id: TENANT_ID, slug: 'kiosco', nombre: 'Kiosco' }
const TENANT_B = { id: TENANT_B_ID, slug: 'otro', nombre: 'Otro' }

const SESION = {
  usuario_id: USUARIO_ID,
  tenant_id: TENANT_ID,
  email: 'ana@kiosco.com',
  nombre: 'Ana',
}

const REGISTRO = {
  email: 'Ana@Kiosco.com',
  password: 'contraseña-larga',
  nombre: 'Ana',
  tenant: { nombre: 'Kiosco', slug: 'Kiosco-Nuevo' },
}

function membresia(tenant: { id: string; slug: string; nombre: string }, rol: string) {
  return { tenant_id: tenant.id, rol, slug: tenant.slug, nombre: tenant.nombre }
}

function reglasDeSesion(rol = 'owner', tenant = TENANT): Regla[] {
  return [
    { sql: /FROM sesiones/, filas: [{ ...SESION, tenant_id: tenant.id }] },
    { sql: /FROM tenants WHERE slug/, filas: [tenant] },
    {
      sql: /FROM membresias WHERE usuario_id = \$1 AND tenant_id = \$2/,
      filas: [{ rol }],
    },
    { sql: /FROM membresias m JOIN tenants/, filas: [membresia(tenant, rol)] },
  ]
}

function servidor(reglas: readonly Regla[]) {
  const doble = crearBaseDoble(reglas)
  return { app: crearServidor({ pool: doble.fuente }), doble }
}

function conToken(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${TOKEN}`, ...extra }
}

/** Las filas de un registro exitoso contra el doble; lo que pase en `extra` gana. */
function reglasDeRegistro(extra: readonly Regla[] = []): Regla[] {
  return [
    ...extra,
    { sql: /^SELECT id FROM usuarios WHERE email/, filas: [] },
    { sql: /^SELECT id FROM tenants WHERE slug/, filas: [] },
    { sql: /^INSERT INTO usuarios/, filas: [{ id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana' }] },
    { sql: /^INSERT INTO tenants/, filas: [TENANT] },
    { sql: /^INSERT INTO membresias/, filas: [] },
    { sql: /^SELECT id, nombre FROM sucursales/, filas: [] },
    { sql: /^INSERT INTO sucursales/, filas: [{ id: '44444444-4444-4444-4444-444444444444', nombre: 'Principal' }] },
    { sql: /^INSERT INTO sesiones/, filas: [{ expira_en: '2030-01-01T00:00:00.000Z' }] },
    ...extra,
  ]
}

function transacciones(doble: ReturnType<typeof crearBaseDoble>) {
  const ids = [...new Set(doble.consultas.map((c) => c.conexion))].filter((id) => id !== 0)
  return ids.map((id) => ({ id, sqls: deLaConexion(doble.consultas, id) }))
}

describe('POST /auth/registro', () => {
  it('crea usuario, tenant, membresía owner, sucursal y sesión en una sola transacción', async () => {
    const { app, doble } = servidor(reglasDeRegistro())

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: REGISTRO,
    })

    expect(respuesta.statusCode).toBe(201)
    const cuerpo = respuesta.json()
    expect(cuerpo).toStrictEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiraEn: '2030-01-01T00:00:00.000Z',
      usuario: { id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana' },
      tenant: { id: TENANT_ID, slug: 'kiosco', nombre: 'Kiosco' },
      rol: 'owner',
      sucursal: { id: '44444444-4444-4444-4444-444444444444', nombre: 'Principal' },
    })

    const [primera] = transacciones(doble)
    expect(transacciones(doble)).toHaveLength(1)
    const sqls = primera?.sqls ?? []
    expect(sqls[0]).toBe('BEGIN')
    expect(sqls.at(-1)).toBe('COMMIT')

    // El tenant se setea después de crearlo y antes de las tablas con RLS (membresías, sucursales).
    const indexTenant = sqls.indexOf('INSERT INTO tenants (slug, nombre) VALUES ($1, $2) RETURNING id, slug, nombre')
    const indexConfig = sqls.findIndex((sql) => sql.startsWith('SELECT set_config'))
    const indexMembresia = sqls.findIndex((sql) => sql.startsWith('INSERT INTO membresias'))
    expect(indexTenant).toBeGreaterThan(-1)
    expect(indexConfig).toBeGreaterThan(indexTenant)
    expect(indexMembresia).toBeGreaterThan(indexConfig)

    const configuracion = doble.consultas.find((c) => c.sql.startsWith('SELECT set_config'))
    expect(configuracion?.valores).toStrictEqual(['app.tenant_id', TENANT_ID])
    expect(doble.liberadas).toStrictEqual([primera?.id])
    await app.close()
  })

  it('normaliza email y slug: la unicidad no depende de mayúsculas', async () => {
    const { app, doble } = servidor(reglasDeRegistro())

    await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO })

    const insertUsuario = doble.consultas.find((c) => c.sql.startsWith('INSERT INTO usuarios'))
    const insertTenant = doble.consultas.find((c) => c.sql.startsWith('INSERT INTO tenants'))
    expect(insertUsuario?.valores[0]).toBe('ana@kiosco.com')
    expect(insertTenant?.valores[0]).toBe('kiosco-nuevo')
    await app.close()
  })

  it('un email tomado es validacion nombrando el campo, y no crea nada', async () => {
    const { app, doble } = servidor(
      reglasDeRegistro([{ sql: /^SELECT id FROM usuarios WHERE email/, filas: [{ id: 'otro' }] }]),
    )

    const respuesta = await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: MENSAJE_EMAIL_OCUPADO, detalle: { campo: 'email' } },
    })
    expect(doble.consultas.some((c) => c.sql.startsWith('INSERT INTO usuarios'))).toBe(false)
    expect(doble.consultas.some((c) => c.sql.startsWith('INSERT INTO tenants'))).toBe(false)
    await app.close()
  })

  it('un slug tomado es validacion nombrando el campo, y no deja usuario huérfano', async () => {
    const { app, doble } = servidor(
      reglasDeRegistro([{ sql: /^SELECT id FROM tenants WHERE slug/, filas: [{ id: 'otro' }] }]),
    )

    const respuesta = await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: MENSAJE_SLUG_OCUPADO, detalle: { campo: 'tenant.slug' } },
    })
    expect(doble.consultas.some((c) => c.sql.startsWith('INSERT INTO usuarios'))).toBe(false)
    await app.close()
  })

  it('una carrera de unicidad que pasa el chequeo previo también es validacion, nunca 500', async () => {
    // Como el error de `pg`: un Error con `code` y `constraint` colgados.
    const violacion = Object.assign(
      new Error('duplicate key value violates unique constraint "usuarios_email_key"'),
      { code: '23505', constraint: 'usuarios_email_key' },
    )
    const { app, doble } = servidor(
      reglasDeRegistro([{ sql: /^INSERT INTO usuarios/, error: violacion }]),
    )

    const respuesta = await app.inject({ method: 'POST', url: '/auth/registro', payload: REGISTRO })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: MENSAJE_EMAIL_OCUPADO, detalle: { campo: 'email' } },
    })
    const [primera] = transacciones(doble)
    expect(primera?.sqls).toContain('ROLLBACK')
    expect(doble.liberadas).toHaveLength(1)
    await app.close()
  })

  it('valida el cuerpo antes de tocar la base', async () => {
    const casos = [
      { payload: { ...REGISTRO, tenant: undefined }, campo: 'tenant' },
      { payload: { ...REGISTRO, email: 'no-es-un-email' }, campo: 'email' },
      { payload: { ...REGISTRO, password: 'corta' }, campo: 'password' },
      { payload: { ...REGISTRO, nombre: '   ' }, campo: 'nombre' },
      { payload: { ...REGISTRO, tenant: { nombre: 'Kiosco', slug: 'Con Mayúsculas Y Espacios' } }, campo: 'tenant.slug' },
    ]

    for (const caso of casos) {
      const { app, doble } = servidor(reglasDeRegistro())
      const respuesta = await app.inject({ method: 'POST', url: '/auth/registro', payload: caso.payload })

      expect(respuesta.statusCode, JSON.stringify(caso.payload)).toBe(400)
      expect(respuesta.json().error.code).toBe('validacion')
      expect(respuesta.json().error.detalle).toStrictEqual({ campo: caso.campo })
      expect(doble.consultas).toStrictEqual([])
      await app.close()
    }
  })
})

describe('POST /auth/sesion', () => {
  it('email desconocido y contraseña incorrecta son indistinguibles', async () => {
    const passwordHash = await hashPassword('la-contraseña-correcta')

    const { app: appSinUsuario } = servidor([
      { sql: /FROM usuarios WHERE email/, filas: [] },
    ])
    const { app: appConUsuario } = servidor([
      {
        sql: /FROM usuarios WHERE email/,
        filas: [{ id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana', password_hash: passwordHash }],
      },
    ])

    const inicioDesconocido = performance.now()
    const desconocido = await appSinUsuario.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: 'nadie@kiosco.com', password: 'otra-contraseña' },
    })
    const costoDesconocido = performance.now() - inicioDesconocido

    const incorrecta = await appConUsuario.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: 'ana@kiosco.com', password: 'otra-contraseña' },
    })

    expect(desconocido.statusCode).toBe(401)
    expect(incorrecta.statusCode).toBe(401)
    expect(desconocido.body).toBe(incorrecta.body)
    expect(desconocido.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Email o contraseña incorrectos.' },
    })
    // Sin usuario igual se deriva scrypt: "no existe" no puede responder en microsegundos.
    expect(costoDesconocido).toBeGreaterThan(5)

    await appSinUsuario.close()
    await appConUsuario.close()
  })

  it('con credenciales correctas devuelve el token una vez y crea la sesión en la transacción', async () => {
    const passwordHash = await hashPassword('la-contraseña-correcta')
    const { app, doble } = servidor([
      {
        sql: /FROM usuarios WHERE email/,
        filas: [{ id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana', password_hash: passwordHash }],
      },
      { sql: /FROM membresias m JOIN tenants/, filas: [membresia(TENANT, 'cajero')] },
      { sql: /^INSERT INTO sesiones/, filas: [{ expira_en: '2030-01-01T00:00:00.000Z' }] },
    ])

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: 'ANA@Kiosco.com', password: 'la-contraseña-correcta' },
    })

    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json()).toStrictEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expiraEn: '2030-01-01T00:00:00.000Z',
      usuario: { id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana' },
      tenant: { id: TENANT_ID, slug: 'kiosco', nombre: 'Kiosco' },
      rol: 'cajero',
    })

    const [primera] = transacciones(doble)
    expect(primera?.sqls[0]).toBe('BEGIN')
    expect(primera?.sqls.at(-1)).toBe('COMMIT')
    const configuracion = doble.consultas.find((c) => c.sql.startsWith('SELECT set_config'))
    expect(configuracion?.valores).toStrictEqual(['app.usuario_id', USUARIO_ID])
    const insertar = doble.consultas.find((c) => c.sql.startsWith('INSERT INTO sesiones'))
    expect(insertar?.conexion).toBe(primera?.id)
    // En `sesiones` va el hash, nunca el token que se le muestra al cliente.
    const token = respuesta.json().token
    expect(insertar?.valores[0]).not.toBe(token)
    expect(insertar?.valores[0]).toMatch(/^[0-9a-f]{64}$/)
    await app.close()
  })

  it('una cuenta sin tenant no recibe sesión', async () => {
    const passwordHash = await hashPassword('la-contraseña-correcta')
    const { app } = servidor([
      {
        sql: /FROM usuarios WHERE email/,
        filas: [{ id: USUARIO_ID, email: 'ana@kiosco.com', nombre: 'Ana', password_hash: passwordHash }],
      },
      { sql: /FROM membresias m JOIN tenants/, filas: [] },
    ])

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: 'ana@kiosco.com', password: 'la-contraseña-correcta' },
    })

    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json().error.code).toBe('sin_permiso')
    await app.close()
  })

  it('valida el cuerpo antes de consultar', async () => {
    const { app, doble } = servidor([])

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: 'ana@kiosco.com', password: '123' },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json().error.detalle).toStrictEqual({ campo: 'password' })
    expect(doble.consultas).toStrictEqual([])
    await app.close()
  })
})

describe('DELETE /auth/sesion', () => {
  it('revoca el token actual y responde 204', async () => {
    const { app, doble } = servidor([...reglasDeSesion(), { sql: /^UPDATE sesiones SET revocada_en/, filas: [] }])

    const respuesta = await app.inject({
      method: 'DELETE',
      url: '/auth/sesion',
      headers: conToken(),
    })

    expect(respuesta.statusCode).toBe(204)
    expect(respuesta.body).toBe('')
    const revocacion = doble.consultas.find((c) => c.sql.startsWith('UPDATE sesiones SET revocada_en'))
    expect(revocacion?.valores[0]).toMatch(/^[0-9a-f]{64}$/)
    await app.close()
  })
})

describe('POST /tenants/:slug/terminales', () => {
  const SUCURSAL = { id: '44444444-4444-4444-4444-444444444444', nombre: 'Centro' }
  const reglasTerminal = (rol = 'owner', tenant = TENANT): Regla[] => [
    ...reglasDeSesion(rol, tenant),
    { sql: /^SELECT id, nombre FROM sucursales/, filas: [SUCURSAL] },
  ]

  it('owner crea una terminal: id nuevo, sucursal del tenant, app.tenant_id en la transacción', async () => {
    const { app, doble } = servidor(reglasTerminal('owner'))

    const respuesta = await app.inject({
      method: 'POST',
      url: '/tenants/kiosco/terminales',
      headers: conToken(),
      payload: { nombre: 'Caja 1', sucursal: 'Centro' },
    })

    expect(respuesta.statusCode).toBe(201)
    const cuerpo = respuesta.json()
    expect(cuerpo).toStrictEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      nombre: 'Caja 1',
      tenantId: TENANT_ID,
      sucursal: SUCURSAL,
    })

    const configuracion = doble.consultas.find(
      (c) => c.sql.startsWith('SELECT set_config') && c.valores[0] === 'app.tenant_id',
    )
    expect(configuracion?.valores).toStrictEqual(['app.tenant_id', TENANT_ID])
    const sucursal = doble.consultas.find((c) => c.sql.startsWith('SELECT id, nombre FROM sucursales'))
    expect(sucursal?.conexion).toBe(configuracion?.conexion)
    expect(sucursal?.conexion).not.toBe(0)
    await app.close()
  })

  it('admin también puede; cajero y solo_lectura no', async () => {
    for (const [rol, esperado] of [
      ['admin', 201],
      ['cajero', 403],
      ['solo_lectura', 403],
    ] as const) {
      const { app } = servidor(reglasTerminal(rol))
      const respuesta = await app.inject({
        method: 'POST',
        url: '/tenants/kiosco/terminales',
        headers: conToken(),
        payload: { nombre: 'Caja 1', sucursal: 'Centro' },
      })
      expect(respuesta.statusCode, rol).toBe(esperado)
      if (esperado === 403) {
        expect(respuesta.json()).toStrictEqual({
          error: { code: 'sin_permiso', mensaje: 'No tenés permiso para esta acción.' },
        })
      }
      await app.close()
    }
  })

  it('crea la sucursal si no existe, dentro del mismo tenant', async () => {
    const { app, doble } = servidor([
      ...reglasDeSesion('owner'),
      { sql: /^SELECT id, nombre FROM sucursales/, filas: [] },
      { sql: /^INSERT INTO sucursales/, filas: [{ id: '55555555-5555-5555-5555-555555555555', nombre: 'Nueva' }] },
    ])

    const respuesta = await app.inject({
      method: 'POST',
      url: '/tenants/kiosco/terminales',
      headers: conToken(),
      payload: { nombre: 'Caja 2', sucursal: 'Nueva' },
    })

    expect(respuesta.statusCode).toBe(201)
    expect(respuesta.json().sucursal).toStrictEqual({ id: '55555555-5555-5555-5555-555555555555', nombre: 'Nueva' })
    const insertSucursal = doble.consultas.find((c) => c.sql.startsWith('INSERT INTO sucursales'))
    const configuracion = doble.consultas.find(
      (c) => c.sql.startsWith('SELECT set_config') && c.valores[0] === 'app.tenant_id',
    )
    expect(insertSucursal?.conexion).toBe(configuracion?.conexion)
    expect(insertSucursal?.valores).toStrictEqual([TENANT_ID, 'Nueva'])
    await app.close()
  })

  it('un token del tenant A no alcanza a la ruta del tenant B', async () => {
    // El middleware resuelve A (única membresía) y la ruta pide B: se rechaza antes de consultar
    // sucursales, aunque el usuario sea owner de A.
    const { app, doble } = servidor([
      { sql: /FROM tenants WHERE slug/, filas: [TENANT_B] },
      ...reglasDeSesion('owner', TENANT),
    ])

    const respuesta = await app.inject({
      method: 'POST',
      url: '/tenants/otro/terminales',
      headers: conToken(),
      payload: { nombre: 'Caja 1', sucursal: 'Centro' },
    })

    expect(respuesta.statusCode).toBe(403)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'No tenés permiso para ese tenant.' },
    })
    expect(doble.consultas.some((c) => c.sql.startsWith('SELECT id, nombre FROM sucursales'))).toBe(false)
    await app.close()
  })

  it('valida nombre y sucursal', async () => {
    for (const [payload, campo] of [
      [{ nombre: '', sucursal: 'Centro' }, 'nombre'],
      [{ nombre: 'Caja 1', sucursal: '' }, 'sucursal'],
    ] as const) {
      const { app, doble } = servidor(reglasTerminal('owner'))
      const respuesta = await app.inject({
        method: 'POST',
        url: '/tenants/kiosco/terminales',
        headers: conToken(),
        payload,
      })
      expect(respuesta.statusCode).toBe(400)
      expect(respuesta.json().error.detalle).toStrictEqual({ campo })
      expect(doble.consultas.some((c) => c.sql.startsWith('SELECT id, nombre FROM sucursales'))).toBe(false)
      await app.close()
    }
  })
})

describe('POST /tenants/:slug/usuarios/:id/password', () => {
  const reglasReset = (rol = 'owner'): Regla[] => [
    ...reglasDeSesion(rol),
    { sql: /FROM membresias WHERE usuario_id = \$1 AND tenant_id = \$2/, filas: [{ rol: 'cajero' }] },
    { sql: /^UPDATE usuarios SET password_hash/, filas: [{ id: USUARIO_ID }] },
  ]

  it('owner resetea la contraseña de un miembro y guarda un hash scrypt, no la contraseña', async () => {
    const { app, doble } = servidor(reglasReset('owner'))

    const respuesta = await app.inject({
      method: 'POST',
      url: `/tenants/kiosco/usuarios/${USUARIO_ID}/password`,
      headers: conToken(),
      payload: { password: 'nueva-contraseña' },
    })

    expect(respuesta.statusCode).toBe(200)
    expect(respuesta.json()).toStrictEqual({ ok: true })

    const actualizacion = doble.consultas.find((c) => c.sql.startsWith('UPDATE usuarios SET password_hash'))
    expect(actualizacion?.valores[0]).toBe(USUARIO_ID)
    expect(String(actualizacion?.valores[1])).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(String(actualizacion?.valores[1])).not.toContain('nueva-contraseña')
    await app.close()
  })

  it('solo_lectura y cajero no administran usuarios', async () => {
    for (const rol of ['solo_lectura', 'cajero'] as const) {
      const { app, doble } = servidor(reglasReset(rol))
      const respuesta = await app.inject({
        method: 'POST',
        url: `/tenants/kiosco/usuarios/${USUARIO_ID}/password`,
        headers: conToken(),
        payload: { password: 'nueva-contraseña' },
      })

      expect(respuesta.statusCode, rol).toBe(403)
      expect(doble.consultas.some((c) => c.sql.startsWith('UPDATE usuarios'))).toBe(false)
      await app.close()
    }
  })

  it('un usuario de otro tenant no se puede tocar', async () => {
    const { app } = servidor([
      { sql: /FROM membresias WHERE usuario_id = \$1 AND tenant_id = \$2/, filas: [] },
      ...reglasDeSesion('owner'),
    ])

    const respuesta = await app.inject({
      method: 'POST',
      url: `/tenants/kiosco/usuarios/${USUARIO_ID}/password`,
      headers: conToken(),
      payload: { password: 'nueva-contraseña' },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: { code: 'validacion', mensaje: MENSAJE_USUARIO_AJENO, detalle: { campo: 'usuario' } },
    })
    await app.close()
  })

  it('un id que no es uuid es validacion, no un error de Postgres', async () => {
    const { app, doble } = servidor(reglasReset('owner'))

    const respuesta = await app.inject({
      method: 'POST',
      url: '/tenants/kiosco/usuarios/no-es-un-uuid/password',
      headers: conToken(),
      payload: { password: 'nueva-contraseña' },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json().error.code).toBe('validacion')
    expect(respuesta.json().error.detalle).toStrictEqual({ campo: 'usuario' })
    expect(doble.consultas.some((c) => c.sql.startsWith('UPDATE usuarios'))).toBe(false)
    await app.close()
  })

  it('valida la contraseña', async () => {
    const { app } = servidor(reglasReset('owner'))

    const respuesta = await app.inject({
      method: 'POST',
      url: `/tenants/kiosco/usuarios/${USUARIO_ID}/password`,
      headers: conToken(),
      payload: { password: '123' },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json().error.detalle).toStrictEqual({ campo: 'password' })
    await app.close()
  })
})
