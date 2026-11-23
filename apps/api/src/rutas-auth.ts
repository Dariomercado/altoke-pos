/**
 * Endpoints de sesión (docs/specs/0003-api-y-sync.md §Auth):
 *
 *   POST   /auth/registro  { email, password, nombre, tenant: { nombre, slug } }
 *   POST   /auth/sesion    { email, password }
 *   GET    /auth/yo
 *   DELETE /auth/sesion
 *
 * El alta crea usuario + tenant + membresía `owner` + sucursal inicial + sesión **en una sola
 * transacción**: si el slug está tomado, no queda un usuario huérfano sin tenant.
 *
 * Email desconocido y contraseña incorrecta son indistinguibles: mismo `no_autenticado`, mismo
 * mensaje, y en el camino sin usuario se deriva `scrypt` igual (contra un hash señuelo) para que
 * el tiempo de respuesta no revele qué emails tienen cuenta.
 */

import type { FastifyInstance } from 'fastify'
import type { FuenteDeConexiones } from './db.ts'
import { autenticacionDe, autenticar } from './auth.ts'
import { noAutenticado, sinPermiso, validacion } from './errores.ts'
import type { ErrorApi } from './errores.ts'
import { hashPassword, verificarPassword, verificarPasswordSenuelo } from './password.ts'
import { generarToken, hashToken, insertarSesion, revocarSesion } from './sesiones.ts'
import { agregarMembresia, asegurarSucursal, crearTenant, listarMembresias } from './tenants.ts'
import { enTransaccion, enTransaccionDeUsuario, fijarTenant, fijarUsuario } from './transaccion.ts'
import { buscarUsuarioPorEmail, crearUsuario } from './usuarios.ts'
import type { Usuario } from './usuarios.ts'
import { leerCuerpo, leerEmail, leerNombre, leerObjeto, leerPassword, leerSlug } from './validacion.ts'

export const MENSAJE_CREDENCIALES = 'Email o contraseña incorrectos.'
export const MENSAJE_EMAIL_OCUPADO = 'Ya existe una cuenta con ese email.'
export const MENSAJE_SLUG_OCUPADO = 'Ya existe un tenant con ese slug.'

/** La sucursal que nace con el tenant. `sucursal` en el resto de la API la reusa por nombre. */
export const SUCURSAL_INICIAL = 'Principal'

type DatosRegistro = {
  readonly email: string
  readonly password: string
  readonly nombre: string
  readonly tenantSlug: string
  readonly tenantNombre: string
}

function leerRegistro(cuerpo: unknown): DatosRegistro {
  const datos = leerCuerpo(cuerpo)
  const tenant = leerObjeto(datos['tenant'], 'tenant')

  return {
    email: leerEmail(datos['email']),
    password: leerPassword(datos['password']),
    nombre: leerNombre(datos['nombre'], 'nombre'),
    tenantSlug: leerSlug(tenant['slug']),
    tenantNombre: leerNombre(tenant['nombre'], 'tenant.nombre'),
  }
}

type RespuestaSesion = {
  readonly token: string
  readonly expiraEn: string
  readonly usuario: Usuario
  readonly tenant: { readonly id: string; readonly slug: string; readonly nombre: string }
  readonly rol: string
}

/**
 * Una violación de unicidad que igual pasó la verificación previa (dos altas simultáneas con el
 * mismo email o slug) se traduce al mismo `validacion`. Nunca un 500 por una carrera.
 */
function campoDeViolacionUnica(error: unknown): 'email' | 'tenant.slug' | undefined {
  if (!(error instanceof Error)) return undefined
  if ((error as { code?: unknown }).code !== '23505') return undefined

  const restriccion = String((error as { constraint?: unknown }).constraint ?? '')
  if (restriccion.includes('email')) return 'email'
  if (restriccion.includes('slug')) return 'tenant.slug'
  return undefined
}

function errorDeUnicidad(campo: 'email' | 'tenant.slug'): ErrorApi {
  if (campo === 'email') return validacion(MENSAJE_EMAIL_OCUPADO, 'email')
  return validacion(MENSAJE_SLUG_OCUPADO, 'tenant.slug')
}

type CuentaCreada = {
  readonly usuario: Usuario
  readonly tenant: { readonly id: string; readonly slug: string; readonly nombre: string }
  readonly sucursal: { readonly id: string; readonly nombre: string }
  readonly expiraEn: string
}

async function crearCuenta(
  fuente: FuenteDeConexiones,
  datos: DatosRegistro,
  passwordHash: string,
  tokenHash: string,
): Promise<CuentaCreada> {
  try {
    return await enTransaccion(fuente, async (conexion) => {
      const emailOcupado = await conexion.query('SELECT id FROM usuarios WHERE email = $1', [
        datos.email,
      ])
      if (emailOcupado.rows.length > 0) throw validacion(MENSAJE_EMAIL_OCUPADO, 'email')

      const slugOcupado = await conexion.query('SELECT id FROM tenants WHERE slug = $1', [
        datos.tenantSlug,
      ])
      if (slugOcupado.rows.length > 0) throw validacion(MENSAJE_SLUG_OCUPADO, 'tenant.slug')

      const usuario = await crearUsuario(conexion, {
        email: datos.email,
        nombre: datos.nombre,
        passwordHash,
      })
      const tenant = await crearTenant(conexion, {
        slug: datos.tenantSlug,
        nombre: datos.tenantNombre,
      })

      // `membresias` y `sucursales` tienen RLS: sin el tenant seteado en esta conexión, el INSERT
      // no cumple la política y la transacción entera se cae (que es lo que debe pasar).
      await fijarTenant(conexion, tenant.id)
      await agregarMembresia(conexion, { usuarioId: usuario.id, tenantId: tenant.id, rol: 'owner' })
      const sucursal = await asegurarSucursal(conexion, tenant.id, SUCURSAL_INICIAL)

      const expiraEn = await insertarSesion(conexion, {
        tokenHash,
        usuarioId: usuario.id,
        tenantId: tenant.id,
      })

      return { usuario, tenant, sucursal, expiraEn }
    })
  } catch (error) {
    const campo = campoDeViolacionUnica(error)
    if (campo !== undefined) throw errorDeUnicidad(campo)
    throw error
  }
}

export function registrarRutasAuth(app: FastifyInstance, fuente: FuenteDeConexiones): void {
  app.post('/auth/registro', async (request, reply) => {
    const datos = leerRegistro(request.body)
    const passwordHash = await hashPassword(datos.password)
    const token = generarToken()

    const cuenta = await crearCuenta(fuente, datos, passwordHash, hashToken(token))

    return reply.status(201).send({
      token,
      expiraEn: cuenta.expiraEn,
      usuario: cuenta.usuario,
      tenant: cuenta.tenant,
      rol: 'owner',
      sucursal: cuenta.sucursal,
    } satisfies RespuestaSesion & { readonly sucursal: { readonly id: string; readonly nombre: string } })
  })

  app.post('/auth/sesion', async (request) => {
    const datos = leerCuerpo(request.body)
    const email = leerEmail(datos['email'])
    const password = leerPassword(datos['password'])
    const token = generarToken()
    const tokenHash = hashToken(token)

    const usuario = await buscarUsuarioPorEmail(fuente, email)
    if (usuario === undefined) {
      await verificarPasswordSenuelo(password)
      throw noAutenticado(MENSAJE_CREDENCIALES)
    }
    if (!(await verificarPassword(password, usuario.passwordHash))) {
      throw noAutenticado(MENSAJE_CREDENCIALES)
    }

    const sesion = await enTransaccion(fuente, async (conexion) => {
      // Las membresías propias se leen con `app.usuario_id`: RLS deja ver sólo las de este usuario.
      await fijarUsuario(conexion, usuario.id)
      const membresias = await listarMembresias(conexion, usuario.id)
      const elegida = membresias[0]
      if (elegida === undefined) {
        // La contraseña era correcta: autenticado. Lo que falta es pertenecer a un tenant.
        throw sinPermiso('Tu cuenta no pertenece a ningún tenant. Hablá con el dueño.')
      }

      const expiraEn = await insertarSesion(conexion, {
        tokenHash,
        usuarioId: usuario.id,
        tenantId: elegida.tenantId,
      })
      return { expiraEn, tenant: elegida }
    })

    return {
      token,
      expiraEn: sesion.expiraEn,
      usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre },
      tenant: { id: sesion.tenant.tenantId, slug: sesion.tenant.slug, nombre: sesion.tenant.nombre },
      rol: sesion.tenant.rol,
    } satisfies RespuestaSesion
  })

  app.get('/auth/yo', { preHandler: autenticar(fuente) }, async (request) => {
    const autenticacion = autenticacionDe(request)
    const membresias = await enTransaccionDeUsuario(fuente, autenticacion.usuarioId, (conexion) =>
      listarMembresias(conexion, autenticacion.usuarioId),
    )

    return {
      usuario: {
        id: autenticacion.usuarioId,
        email: autenticacion.email,
        nombre: autenticacion.nombre,
      },
      membresias: membresias.map((membresia) => ({
        tenantId: membresia.tenantId,
        slug: membresia.slug,
        nombre: membresia.nombre,
        rol: membresia.rol,
      })),
    }
  })

  app.delete('/auth/sesion', { preHandler: autenticar(fuente) }, async (request, reply) => {
    const autenticacion = autenticacionDe(request)
    await revocarSesion(fuente, autenticacion.tokenHash)
    return reply.status(204).send()
  })
}
