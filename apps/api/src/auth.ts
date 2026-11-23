/**
 * Middleware de sesión, tenant y rol (docs/specs/0003-api-y-sync.md §Auth, tarea T3).
 *
 * Un pedido autenticado llega con `Authorization: Bearer <token>` y, si el usuario tiene más de un
 * tenant, con `X-Tenant: <slug>` (se acepta también el id). De ahí sale la `Autenticacion` del
 * pedido: `usuarioId`, `tenantId`, `rol`. El resto del código no vuelve a mirar el token.
 *
 * Reglas que este archivo hace cumplir:
 *   - Token vencido, revocado, inexistente o con forma inválida → `no_autenticado`.
 *   - Un tenant pedido que el usuario no tiene → `sin_permiso`, nunca una consulta que devuelva
 *     vacío y parezca que salió bien.
 *   - Rol insuficiente → `sin_permiso`.
 */

import type { FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { FuenteDeConexiones } from './db.ts'
import { noAutenticado, sinPermiso, tenantDesconocido, validacion } from './errores.ts'
import { esTokenConForma, buscarSesionActiva, hashToken } from './sesiones.ts'
import { buscarMembresia, buscarTenant, listarMembresias } from './tenants.ts'
import { rolAlcanza } from './roles.ts'
import type { Rol } from './roles.ts'
import { enTransaccionDeTenant, enTransaccionDeUsuario } from './transaccion.ts'

export type Autenticacion = {
  readonly usuarioId: string
  readonly email: string
  readonly nombre: string
  readonly tenantId: string
  readonly rol: Rol
  readonly tokenHash: string
}

declare module 'fastify' {
  interface FastifyRequest {
    autenticacion?: Autenticacion
  }
}

export const ENCABEZADO_TENANT = 'x-tenant'

export function leerBearer(encabezado: string | undefined): string | undefined {
  if (encabezado === undefined) return undefined
  const partes = encabezado.trim().split(/\s+/)
  if (partes.length !== 2) return undefined
  const [esquema, token] = partes
  if (esquema?.toLowerCase() !== 'bearer' || token === undefined) return undefined
  return token
}

export function leerEncabezado(request: FastifyRequest, nombre: string): string | undefined {
  const valor = request.headers[nombre]
  const texto = Array.isArray(valor) ? valor[0] : valor
  const limpio = texto?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}

/** La autenticación que puso `autenticar`. Un handler sin ella es un handler mal encadenado. */
export function autenticacionDe(request: FastifyRequest): Autenticacion {
  const autenticacion = request.autenticacion
  if (autenticacion === undefined) throw noAutenticado()
  return autenticacion
}

type TenantResuelto = { readonly tenantId: string; readonly rol: Rol }

async function resolverTenant(
  fuente: FuenteDeConexiones,
  usuarioId: string,
  tenantPedido: string | undefined,
): Promise<TenantResuelto> {
  if (tenantPedido !== undefined) {
    const tenant = await buscarTenant(fuente, tenantPedido)
    if (tenant === undefined) throw tenantDesconocido()

    const rol = await enTransaccionDeTenant(fuente, tenant.id, (conexion) =>
      buscarMembresia(conexion, usuarioId, tenant.id),
    )
    if (rol === undefined) throw sinPermiso('No tenés permiso para ese tenant.')
    return { tenantId: tenant.id, rol }
  }

  const membresias = await enTransaccionDeUsuario(fuente, usuarioId, (conexion) =>
    listarMembresias(conexion, usuarioId),
  )
  if (membresias.length === 0) throw sinPermiso('Tu cuenta no pertenece a ningún tenant.')

  const unica = membresias.length === 1 ? membresias[0] : undefined
  if (unica === undefined) {
    // El spec no define "elegí tenant": el código más cercano es `validacion`, y el detalle dice
    // qué encabezado falta. Nunca se elige un tenant al azar por el usuario.
    throw validacion('Tenés más de un tenant: mandá X-Tenant con el slug.', 'X-Tenant')
  }
  return { tenantId: unica.tenantId, rol: unica.rol }
}

export function autenticar(fuente: FuenteDeConexiones): preHandlerHookHandler {
  return async (request) => {
    const token = leerBearer(request.headers.authorization)
    if (token === undefined || !esTokenConForma(token)) throw noAutenticado()

    const tokenHash = hashToken(token)
    const sesion = await buscarSesionActiva(fuente, tokenHash)
    if (sesion === undefined) throw noAutenticado()

    const tenant = await resolverTenant(
      fuente,
      sesion.usuarioId,
      leerEncabezado(request, ENCABEZADO_TENANT),
    )

    request.autenticacion = {
      usuarioId: sesion.usuarioId,
      email: sesion.email,
      nombre: sesion.nombre,
      tenantId: tenant.tenantId,
      rol: tenant.rol,
      tokenHash,
    }
  }
}

/**
 * Guarda reutilizable: sólo los roles listados pasan. Sin roles permisivos por defecto: una lista
 * vacía no deja pasar a nadie.
 */
export function requiereRol(...roles: readonly Rol[]): preHandlerHookHandler {
  return async (request) => {
    const autenticacion = autenticacionDe(request)
    if (!roles.includes(autenticacion.rol)) throw sinPermiso()
  }
}

/** Guarda por nivel: `requiereAlMenos('cajero')` deja pasar cajero, admin y owner. */
export function requiereAlMenos(minimo: Rol): preHandlerHookHandler {
  return async (request) => {
    const autenticacion = autenticacionDe(request)
    if (!rolAlcanza(autenticacion.rol, minimo)) throw sinPermiso()
  }
}
