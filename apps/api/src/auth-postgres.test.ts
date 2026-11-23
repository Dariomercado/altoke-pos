/**
 * Auth contra un Postgres real, con los dos roles del compose.
 *
 * Lo que sólo se puede probar con base:
 *   - el alta es atómica (un slug duplicado no deja un usuario huérfano),
 *   - la base guarda el hash del token y el hash de la contraseña, nunca el original,
 *   - un token vencido o revocado no entra,
 *   - RLS + membresía: `solo_lectura` recibe `sin_permiso` en una ruta de administración y un
 *     token del tenant A no alcanza al tenant B,
 *   - un reset de contraseña exige un rol estrictamente menor y revoca las sesiones del objetivo,
 *   - dos altas simultáneas y dos terminales simultáneas no dan 500 ni duplican datos.
 *
 * Sin `DATABASE_URL` la suite se **omite con un aviso explícito**: omitir no es pasar.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearPool } from './db.ts'
import { MAXIMO_INTENTOS_POR_DEFECTO } from './limite-de-intentos.ts'
import type { FuenteDeConexiones } from './db.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'
import { hashPassword } from './password.ts'
import { crearServidor } from './servidor.ts'
import { hashToken } from './sesiones.ts'

const DIRECTORIO_MIGRACIONES = `${import.meta.dirname}/../migrations`
const PASSWORD = 'contraseña-de-prueba'

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}

const urlApp = texto(process.env.DATABASE_URL)
const urlDuenio = texto(process.env.MIGRATIONS_DATABASE_URL) ?? urlApp
const sinBase = urlApp === undefined || urlDuenio === undefined

if (sinBase) {
  process.stderr.write(
    '[apps/api] DATABASE_URL ausente: se OMITEN los tests de auth contra Postgres (19 tests). ' +
      'Para correrlos: pnpm db:up y después ' +
      'DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke ' +
      'MIGRATIONS_DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm test.\n',
  )
}

type CuentaRegistrada = {
  readonly token: string
  readonly expiraEn: string
  readonly usuario: { readonly id: string; readonly email: string; readonly nombre: string }
  readonly tenant: { readonly id: string; readonly slug: string; readonly nombre: string }
  readonly rol: string
  readonly sucursal: { readonly id: string; readonly nombre: string }
}

function bearer(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra }
}

describe.skipIf(sinBase)('auth contra Postgres', () => {
  let duenio: FuenteDeConexiones
  let pool: FuenteDeConexiones
  let app: FastifyInstance

  // Un prefijo por corrida: la limpieza no toca datos de nadie más.
  const sufijo = randomUUID().slice(0, 8)
  const email = (nombre: string): string => `auth-test-${sufijo}-${nombre}@kiosco.com`
  const slug = (nombre: string): string => `auth-test-${sufijo}-${nombre}`

  beforeAll(async () => {
    duenio = crearPool(urlDuenio as string)
    await aplicarMigraciones(duenio, leerMigraciones(DIRECTORIO_MIGRACIONES))
    pool = crearPool(urlApp as string)
    app = crearServidor({ pool })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
    await duenio.query('DELETE FROM usuarios WHERE email LIKE $1', [`auth-test-${sufijo}-%`])
    await duenio.query('DELETE FROM tenants WHERE slug LIKE $1', [`auth-test-${sufijo}-%`])
    await duenio.end()
  })

  async function registrar(nombre: string): Promise<CuentaRegistrada> {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: {
        email: email(nombre),
        password: PASSWORD,
        nombre: nombre,
        tenant: { nombre: `Kiosco ${nombre}`, slug: slug(nombre) },
      },
    })

    expect(respuesta.statusCode, respuesta.body).toBe(201)
    return respuesta.json() as CuentaRegistrada
  }

  async function crearMiembro(
    tenantId: string,
    nombre: string,
    rol: 'owner' | 'admin' | 'cajero' | 'solo_lectura',
    password = PASSWORD,
  ): Promise<string> {
    const usuarioId = randomUUID()
    await duenio.query(
      `INSERT INTO usuarios (id, email, nombre, password_hash) VALUES ($1, $2, $3, $4)`,
      [usuarioId, email(nombre), nombre, await hashPassword(password)],
    )
    await duenio.query(
      `INSERT INTO membresias (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)`,
      [usuarioId, tenantId, rol],
    )
    return usuarioId
  }

  async function iniciarSesion(nombre: string, password = PASSWORD): Promise<string> {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email(nombre), password },
    })
    expect(login.statusCode, login.body).toBe(200)
    return login.json().token as string
  }

  it('registro crea usuario, tenant, membresía owner, sucursal y sesión; yo los devuelve', async () => {
    const cuenta = await registrar('ana')

    expect(cuenta.rol).toBe('owner')
    expect(cuenta.tenant.slug).toBe(slug('ana'))
    expect(cuenta.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(cuenta.sucursal.nombre).toBe('Principal')

    const yo = await app.inject({ method: 'GET', url: '/auth/yo', headers: bearer(cuenta.token) })

    expect(yo.statusCode, yo.body).toBe(200)
    expect(yo.json()).toStrictEqual({
      usuario: { id: cuenta.usuario.id, email: email('ana'), nombre: 'ana' },
      membresias: [
        { tenantId: cuenta.tenant.id, slug: slug('ana'), nombre: 'Kiosco ana', rol: 'owner' },
      ],
    })
  })

  it('la base no guarda el token ni la contraseña en claro', async () => {
    const cuenta = await registrar('sin-claro')

    const sesiones = await duenio.query(
      `SELECT token_hash, expira_en > now() AS vigente FROM sesiones WHERE usuario_id = $1`,
      [cuenta.usuario.id],
    )
    expect(sesiones.rows).toHaveLength(1)
    const tokenHash = String(sesiones.rows[0]?.['token_hash'])
    expect(tokenHash).toBe(hashToken(cuenta.token))
    expect(tokenHash).not.toContain(cuenta.token)
    expect(sesiones.rows[0]?.['vigente']).toBe(true)

    const usuarios = await duenio.query(`SELECT password_hash FROM usuarios WHERE id = $1`, [
      cuenta.usuario.id,
    ])
    const passwordHash = String(usuarios.rows[0]?.['password_hash'])
    expect(passwordHash).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(passwordHash).not.toContain(PASSWORD)
  })

  it('el alta es atómica: un slug duplicado no deja un usuario huérfano', async () => {
    const primera = await registrar('slug-uno')

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: {
        email: email('slug-dos'),
        password: PASSWORD,
        nombre: 'Dos',
        tenant: { nombre: 'Kiosco Dos', slug: slug('slug-uno') },
      },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: 'Ya existe un tenant con ese slug.',
        detalle: { campo: 'tenant.slug' },
      },
    })

    const huerfano = await duenio.query(`SELECT count(*)::int AS total FROM usuarios WHERE email = $1`, [
      email('slug-dos'),
    ])
    expect(huerfano.rows[0]?.['total'], 'la transacción entera se revierte').toBe(0)

    const tenants = await duenio.query(`SELECT count(*)::int AS total FROM tenants WHERE slug = $1`, [
      slug('slug-uno'),
    ])
    expect(tenants.rows[0]?.['total']).toBe(1)
    expect(primera.tenant.slug).toBe(slug('slug-uno'))
  })

  it('un email duplicado no crea un tenant a medias', async () => {
    await registrar('email-uno')

    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: {
        email: email('email-uno'),
        password: PASSWORD,
        nombre: 'Otro',
        tenant: { nombre: 'Kiosco otro', slug: slug('email-dos') },
      },
    })

    expect(respuesta.statusCode).toBe(400)
    expect(respuesta.json().error).toStrictEqual({
      code: 'validacion',
      mensaje: 'Ya existe una cuenta con ese email.',
      detalle: { campo: 'email' },
    })

    const tenants = await duenio.query(`SELECT count(*)::int AS total FROM tenants WHERE slug = $1`, [
      slug('email-dos'),
    ])
    expect(tenants.rows[0]?.['total']).toBe(0)
  })

  it('email desconocido y contraseña incorrecta son indistinguibles, también en el tiempo', async () => {
    const cuenta = await registrar('login')

    const inicio = performance.now()
    const desconocido = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('no-existe'), password: PASSWORD },
    })
    const costoDesconocido = performance.now() - inicio

    const incorrecta = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: cuenta.usuario.email, password: `${PASSWORD}-mal` },
    })

    expect(desconocido.statusCode).toBe(401)
    expect(incorrecta.statusCode).toBe(401)
    expect(desconocido.body).toBe(incorrecta.body)
    expect(desconocido.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Email o contraseña incorrectos.' },
    })
    expect(costoDesconocido, 'sin usuario igual se deriva scrypt').toBeGreaterThan(5)

    const correcta = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: cuenta.usuario.email, password: PASSWORD },
    })
    expect(correcta.statusCode, correcta.body).toBe(200)
    expect(correcta.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('un token vencido se rechaza como no_autenticado', async () => {
    const cuenta = await registrar('vencido')
    await duenio.query(
      `UPDATE sesiones SET expira_en = now() - interval '1 minute' WHERE token_hash = $1`,
      [hashToken(cuenta.token)],
    )

    const yo = await app.inject({ method: 'GET', url: '/auth/yo', headers: bearer(cuenta.token) })

    expect(yo.statusCode).toBe(401)
    expect(yo.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })
  })

  it('un token revocado se rechaza, y revocar dos veces también', async () => {
    const cuenta = await registrar('revocado')

    const revocar = await app.inject({
      method: 'DELETE',
      url: '/auth/sesion',
      headers: bearer(cuenta.token),
    })
    expect(revocar.statusCode).toBe(204)

    const yo = await app.inject({ method: 'GET', url: '/auth/yo', headers: bearer(cuenta.token) })
    expect(yo.statusCode).toBe(401)

    const segunda = await app.inject({
      method: 'DELETE',
      url: '/auth/sesion',
      headers: bearer(cuenta.token),
    })
    expect(segunda.statusCode).toBe(401)
  })

  it('solo_lectura no crea terminales aunque pueda leer su tenant', async () => {
    const cuenta = await registrar('roles')
    await crearMiembro(cuenta.tenant.id, 'lectura', 'solo_lectura')
    await crearMiembro(cuenta.tenant.id, 'cajero', 'cajero')

    for (const [nombre, esperado] of [
      ['lectura', 403],
      ['cajero', 403],
    ] as const) {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/sesion',
        payload: { email: email(nombre), password: PASSWORD },
      })
      expect(login.statusCode, login.body).toBe(200)
      const token = login.json().token as string

      const yo = await app.inject({ method: 'GET', url: '/auth/yo', headers: bearer(token) })
      expect(yo.statusCode).toBe(200)

      const terminal = await app.inject({
        method: 'POST',
        url: `/tenants/${cuenta.tenant.slug}/terminales`,
        headers: bearer(token),
        payload: { nombre: 'Caja 9', sucursal: 'Principal' },
      })

      expect(terminal.statusCode, `${nombre} intentando crear una terminal`).toBe(esperado)
      expect(terminal.json()).toStrictEqual({
        error: { code: 'sin_permiso', mensaje: 'No tenés permiso para esta acción.' },
      })
    }
  })

  it('un token del tenant A no alcanza al tenant B', async () => {
    const a = await registrar('tenant-a')
    const b = await registrar('tenant-b')

    const yo = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: bearer(a.token, { 'x-tenant': b.tenant.slug }),
    })
    expect(yo.statusCode).toBe(403)
    expect(yo.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'No tenés permiso para ese tenant.' },
    })

    const terminal = await app.inject({
      method: 'POST',
      url: `/tenants/${b.tenant.slug}/terminales`,
      headers: bearer(a.token, { 'x-tenant': b.tenant.slug }),
      payload: { nombre: 'Caja 1', sucursal: 'Principal' },
    })
    expect(terminal.statusCode).toBe(403)
  })

  it('owner crea una terminal y reusa la sucursal inicial del tenant', async () => {
    const cuenta = await registrar('terminal')

    const respuesta = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/terminales`,
      headers: bearer(cuenta.token),
      payload: { nombre: 'Caja 1', sucursal: 'Principal' },
    })

    expect(respuesta.statusCode, respuesta.body).toBe(201)
    expect(respuesta.json()).toStrictEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      nombre: 'Caja 1',
      tenantId: cuenta.tenant.id,
      sucursal: cuenta.sucursal,
    })

    const terminalOtraSucursal = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/terminales`,
      headers: bearer(cuenta.token),
      payload: { nombre: 'Caja 2', sucursal: 'Depósito' },
    })
    expect(terminalOtraSucursal.statusCode).toBe(201)
    expect(terminalOtraSucursal.json().sucursal.nombre).toBe('Depósito')
  })

  it('owner resetea la contraseña de un miembro y el login nuevo funciona', async () => {
    const cuenta = await registrar('reset')
    const cajeroId = await crearMiembro(cuenta.tenant.id, 'reset-cajero', 'cajero', 'vieja-contraseña')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${cajeroId}/password`,
      headers: bearer(cuenta.token),
      payload: { password: 'nueva-contraseña' },
    })
    expect(reset.statusCode, reset.body).toBe(200)
    expect(reset.json()).toStrictEqual({ ok: true })

    const conNueva = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('reset-cajero'), password: 'nueva-contraseña' },
    })
    expect(conNueva.statusCode, conNueva.body).toBe(200)
    expect(conNueva.json().rol).toBe('cajero')

    const conVieja = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('reset-cajero'), password: 'vieja-contraseña' },
    })
    expect(conVieja.statusCode).toBe(401)

    const ajeno = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${randomUUID()}/password`,
      headers: bearer(cuenta.token),
      payload: { password: 'nueva-contraseña' },
    })
    expect(ajeno.statusCode).toBe(400)
    expect(ajeno.json().error.detalle).toStrictEqual({ campo: 'usuario' })
  })

  it('un admin no puede resetear al owner', async () => {
    const cuenta = await registrar('rol-owner')
    await crearMiembro(cuenta.tenant.id, 'rol-admin', 'admin')
    const tokenAdmin = await iniciarSesion('rol-admin')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${cuenta.usuario.id}/password`,
      headers: bearer(tokenAdmin),
      payload: { password: 'tomada-por-el-admin' },
    })

    expect(reset.statusCode, reset.body).toBe(403)
    expect(reset.json()).toStrictEqual({
      error: {
        code: 'sin_permiso',
        mensaje: 'No podés resetear la contraseña de alguien con tu rol o uno mayor.',
      },
    })
    // La contraseña del owner no cambió: el reset no pasó.
    await iniciarSesion('rol-owner')
  })

  it('un admin no puede resetear a otro admin', async () => {
    const cuenta = await registrar('rol-admin-admin')
    await crearMiembro(cuenta.tenant.id, 'rol-admin-a', 'admin')
    const otroAdmin = await crearMiembro(cuenta.tenant.id, 'rol-admin-b', 'admin', 'clave-del-otro')
    const token = await iniciarSesion('rol-admin-a')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${otroAdmin}/password`,
      headers: bearer(token),
      payload: { password: 'tomada-por-el-admin' },
    })

    expect(reset.statusCode, reset.body).toBe(403)
    expect(reset.json()).toStrictEqual({
      error: {
        code: 'sin_permiso',
        mensaje: 'No podés resetear la contraseña de alguien con tu rol o uno mayor.',
      },
    })
    await iniciarSesion('rol-admin-b', 'clave-del-otro')
  })

  it('un admin sí puede resetear a un cajero', async () => {
    const cuenta = await registrar('rol-admin-cajero')
    await crearMiembro(cuenta.tenant.id, 'rol-admin-del-tenant', 'admin')
    const cajeroId = await crearMiembro(cuenta.tenant.id, 'rol-cajero', 'cajero', 'clave-vieja')
    const token = await iniciarSesion('rol-admin-del-tenant')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${cajeroId}/password`,
      headers: bearer(token),
      payload: { password: 'nueva-contraseña' },
    })

    expect(reset.statusCode, reset.body).toBe(200)
    expect(reset.json()).toStrictEqual({ ok: true })
    await iniciarSesion('rol-cajero', 'nueva-contraseña')

    const conVieja = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('rol-cajero'), password: 'clave-vieja' },
    })
    expect(conVieja.statusCode).toBe(401)
  })

  it('un owner sí puede resetear a un admin', async () => {
    const cuenta = await registrar('rol-owner-admin')
    const adminId = await crearMiembro(cuenta.tenant.id, 'rol-admin-de-owner', 'admin', 'clave-vieja')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${adminId}/password`,
      headers: bearer(cuenta.token),
      payload: { password: 'nueva-contraseña' },
    })

    expect(reset.statusCode, reset.body).toBe(200)
    expect(reset.json()).toStrictEqual({ ok: true })
    await iniciarSesion('rol-admin-de-owner', 'nueva-contraseña')
  })

  it('resetear la contraseña de otro usuario revoca sus sesiones abiertas', async () => {
    const cuenta = await registrar('revoca')
    const cajeroId = await crearMiembro(cuenta.tenant.id, 'revoca-cajero', 'cajero')
    const tokenViejo = await iniciarSesion('revoca-cajero')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${cajeroId}/password`,
      headers: bearer(cuenta.token),
      payload: { password: 'nueva-contraseña' },
    })
    expect(reset.statusCode, reset.body).toBe(200)

    const conTokenViejo = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: bearer(tokenViejo),
    })
    expect(conTokenViejo.statusCode, conTokenViejo.body).toBe(401)
    expect(conTokenViejo.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })

    // Revocar sesiones no es bloquear la cuenta: con la contraseña nueva se entra.
    await iniciarSesion('revoca-cajero', 'nueva-contraseña')
  })

  it('la sesión desde la que el actor resetea su propia contraseña sigue viva', async () => {
    const cuenta = await registrar('auto-reset')

    const reset = await app.inject({
      method: 'POST',
      url: `/tenants/${cuenta.tenant.slug}/usuarios/${cuenta.usuario.id}/password`,
      headers: bearer(cuenta.token),
      payload: { password: 'nueva-contraseña' },
    })
    expect(reset.statusCode, reset.body).toBe(200)

    const yo = await app.inject({ method: 'GET', url: '/auth/yo', headers: bearer(cuenta.token) })
    expect(yo.statusCode, yo.body).toBe(200)
    expect(yo.json().usuario.id).toBe(cuenta.usuario.id)

    const conVieja = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('auto-reset'), password: PASSWORD },
    })
    expect(conVieja.statusCode).toBe(401)
    await iniciarSesion('auto-reset', 'nueva-contraseña')
  })

  it('dos altas simultáneas con el mismo tenant no dan 500 ni dejan dos sucursales', async () => {
    const nombreSlug = slug('carrera')
    const payload = (nombre: string) => ({
      email: email(`carrera-${nombre}`),
      password: PASSWORD,
      nombre: `Carrera ${nombre}`,
      tenant: { nombre: 'Kiosco carrera', slug: nombreSlug },
    })

    const [uno, dos] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/registro', payload: payload('uno') }),
      app.inject({ method: 'POST', url: '/auth/registro', payload: payload('dos') }),
    ])

    // Uno crea el tenant; el otro recibe un error que puede corregir. Nunca un 500.
    expect([uno.statusCode, dos.statusCode].sort(), `${uno.body} / ${dos.body}`).toStrictEqual([
      201, 400,
    ])
    const perdedor = [uno, dos].find((respuesta) => respuesta.statusCode === 400)
    expect(perdedor?.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: 'Ya existe un tenant con ese slug.',
        detalle: { campo: 'tenant.slug' },
      },
    })

    const tenants = await duenio.query(`SELECT id FROM tenants WHERE slug = $1`, [nombreSlug])
    expect(tenants.rows).toHaveLength(1)

    const sucursales = await duenio.query(
      `SELECT lower(nombre) AS nombre, count(*)::int AS total
       FROM sucursales WHERE tenant_id = $1 GROUP BY lower(nombre)`,
      [tenants.rows[0]?.['id']],
    )
    expect(sucursales.rows).toStrictEqual([{ nombre: 'principal', total: 1 }])
  })

  it('dos terminales simultáneas con la misma sucursal nueva reusan una sola sucursal', async () => {
    const cuenta = await registrar('carrera-sucursal')

    const terminales = await Promise.all(
      ['Caja 1', 'Caja 2'].map((nombre) =>
        app.inject({
          method: 'POST',
          url: `/tenants/${cuenta.tenant.slug}/terminales`,
          headers: bearer(cuenta.token),
          payload: { nombre, sucursal: 'Depósito' },
        }),
      ),
    )

    for (const terminal of terminales) {
      expect(terminal.statusCode, terminal.body).toBe(201)
    }
    const ids = terminales.map((terminal) => terminal.json().sucursal.id as string)
    expect(new Set(ids).size, terminales.map((terminal) => terminal.body).join(' / ')).toBe(1)

    const filas = await duenio.query(
      `SELECT id FROM sucursales WHERE tenant_id = $1 AND lower(nombre) = lower($2)`,
      [cuenta.tenant.id, 'Depósito'],
    )
    expect(filas.rows).toHaveLength(1)
  })

  it('con dos membresías la sesión usa el tenant más antiguo y X-Tenant elige el otro rol', async () => {
    const viejo = await registrar('multi-viejo')
    const nuevo = await registrar('multi-nuevo')

    // El mismo usuario, cajero en el tenant viejo y admin en el nuevo.
    const usuarioId = await crearMiembro(viejo.tenant.id, 'multi', 'cajero')
    await duenio.query(`INSERT INTO membresias (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)`, [
      usuarioId,
      nuevo.tenant.id,
      'admin',
    ])
    // El default se elige por antigüedad del **tenant**, no por el orden de la membresía: lo fijo en
    // el reloj para que el test no dependa de dos `now()` distintos por microsegundos.
    await duenio.query(`UPDATE tenants SET creado_en = now() - interval '1 hour' WHERE id = $1`, [
      viejo.tenant.id,
    ])

    const login = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('multi'), password: PASSWORD },
    })
    expect(login.statusCode, login.body).toBe(200)

    const sesion = login.json() as { token: string; tenant: { id: string }; rol: string }
    expect(sesion.tenant.id, 'el default es el tenant más antiguo').toBe(viejo.tenant.id)
    expect(sesion.rol).toBe('cajero')

    // El rol sale de la membresía del tenant que se atiende: `cajero` no crea terminales…
    const sinTenant = await app.inject({
      method: 'POST',
      url: `/tenants/${viejo.tenant.slug}/terminales`,
      headers: bearer(sesion.token),
      payload: { nombre: 'Caja 2', sucursal: 'Principal' },
    })
    // Con más de una membresía el servidor no elige por su cuenta ni siquiera con default en la
    // sesión: `X-Tenant` es obligatorio, y lo dice como validación, no como falta de permiso.
    expect(sinTenant.statusCode, sinTenant.body).toBe(400)
    expect(sinTenant.json().error.detalle.campo).toBe('X-Tenant')

    const sinPermiso = await app.inject({
      method: 'POST',
      url: `/tenants/${viejo.tenant.slug}/terminales`,
      headers: { ...bearer(sesion.token), 'x-tenant': viejo.tenant.slug },
      payload: { nombre: 'Caja 2', sucursal: 'Principal' },
    })
    expect(sinPermiso.statusCode, sinPermiso.body).toBe(403)

    // …y el mismo token con `X-Tenant` es `admin` en el otro tenant.
    const conPermiso = await app.inject({
      method: 'POST',
      url: `/tenants/${nuevo.tenant.slug}/terminales`,
      headers: { ...bearer(sesion.token), 'x-tenant': nuevo.tenant.slug },
      payload: { nombre: 'Caja 2', sucursal: 'Principal' },
    })
    expect(conPermiso.statusCode, conPermiso.body).toBe(201)
  })

  it('el login se frena después de demasiados intentos fallidos para el mismo email', async () => {
    await registrar('limite')

    for (let intento = 1; intento <= MAXIMO_INTENTOS_POR_DEFECTO; intento += 1) {
      const fallo = await app.inject({
        method: 'POST',
        url: '/auth/sesion',
        payload: { email: email('limite'), password: 'no-es-la-contraseña' },
      })
      expect(fallo.statusCode, `intento ${intento}: ${fallo.body}`).toBe(401)
    }

    // La contraseña correcta tampoco entra: el bloqueo es del par (email, cliente), no del intento.
    const bloqueado = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email('limite'), password: PASSWORD },
    })
    expect(bloqueado.statusCode, bloqueado.body).toBe(429)
    expect(bloqueado.json().error.code).toBe('demasiados_intentos')
    expect(String(bloqueado.json().error.mensaje)).toContain('Demasiados intentos')

    // Otro email del mismo local no queda castigado por el ataque a este.
    const otro = await registrar('limite-otro')
    expect(otro.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

})
