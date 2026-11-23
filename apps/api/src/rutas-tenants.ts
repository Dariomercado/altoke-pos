/**
 * Administración del tenant (docs/specs/0003-api-y-sync.md §Auth):
 *
 *   POST /tenants/:slug/terminales           { nombre, sucursal }  (owner|admin) → terminal
 *   POST /tenants/:slug/usuarios/:id/password { password }         (owner|admin) → ok
 *
 * El `:slug` de la ruta tiene que coincidir con el tenant que eligió el middleware (`X-Tenant`, o
 * la única membresía). Un token del tenant A que pide el tenant B es `sin_permiso`: la ruta no
 * puede ser una forma de saltear la elección de tenant.
 *
 * Silencio del spec que se resuelve acá: §Esquema no tiene tabla `terminales`. El endpoint devuelve
 * el id que la terminal usa como `terminalId` en el sync y en el que el servidor no guarda nada
 * todavía; `sucursal` llega como nombre y se reusa/crea dentro del tenant.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { FuenteDeConexiones } from './db.ts'
import { autenticacionDe, autenticar, requiereRol } from './auth.ts'
import { sinPermiso, tenantDesconocido, validacion } from './errores.ts'
import { hashPassword } from './password.ts'
import { rolSupera } from './roles.ts'
import { revocarSesionesDeUsuario } from './sesiones.ts'
import { asegurarSucursal, buscarMembresia, buscarTenant } from './tenants.ts'
import type { Tenant } from './tenants.ts'
import { enTransaccionDeTenant } from './transaccion.ts'
import { actualizarPassword } from './usuarios.ts'
import { leerCuerpo, leerNombre, leerPassword, leerUuid } from './validacion.ts'

export const MENSAJE_USUARIO_AJENO = 'Ese usuario no pertenece a este tenant.'
export const MENSAJE_USUARIO_INEXISTENTE = 'Ese usuario no existe.'
export const MENSAJE_ROL_NO_ALCANZA =
  'No podés resetear la contraseña de alguien con tu rol o uno mayor.'

type ParametrosDeRuta = { readonly slug?: string; readonly id?: string }

/** Sin schema de ruta, Fastify 5 tipa `params` como `unknown`: se lee una vez y se valida abajo. */
function parametros(request: FastifyRequest): ParametrosDeRuta {
  return request.params as ParametrosDeRuta
}

/**
 * Resuelve el tenant de la ruta y exige que sea el mismo que eligió `autenticar`. Se hace antes de
 * la transacción: `tenants` no tiene RLS y el id es lo que permite setear `app.tenant_id`.
 */
async function tenantDeLaRuta(
  fuente: FuenteDeConexiones,
  slugDeLaRuta: string | undefined,
  tenantAutenticado: string,
): Promise<Tenant> {
  if (slugDeLaRuta === undefined || slugDeLaRuta.trim() === '') throw tenantDesconocido()

  const tenant = await buscarTenant(fuente, slugDeLaRuta.trim())
  if (tenant === undefined) throw tenantDesconocido()
  if (tenant.id !== tenantAutenticado) throw sinPermiso('No tenés permiso para ese tenant.')
  return tenant
}

export function registrarRutasTenants(app: FastifyInstance, fuente: FuenteDeConexiones): void {
  app.post(
    '/tenants/:slug/terminales',
    { preHandler: [autenticar(fuente), requiereRol('owner', 'admin')] },
    async (request, reply) => {
      const autenticacion = autenticacionDe(request)
      const tenant = await tenantDeLaRuta(
        fuente,
        parametros(request).slug,
        autenticacion.tenantId,
      )

      const datos = leerCuerpo(request.body)
      const nombre = leerNombre(datos['nombre'], 'nombre')
      const nombreSucursal = leerNombre(datos['sucursal'], 'sucursal')

      const terminal = await enTransaccionDeTenant(fuente, tenant.id, async (conexion) => {
        const sucursal = await asegurarSucursal(conexion, tenant.id, nombreSucursal)
        return { id: randomUUID(), nombre, tenantId: tenant.id, sucursal }
      })

      return reply.status(201).send(terminal)
    },
  )

  app.post(
    '/tenants/:slug/usuarios/:id/password',
    { preHandler: [autenticar(fuente), requiereRol('owner', 'admin')] },
    async (request) => {
      const autenticacion = autenticacionDe(request)
      const tenant = await tenantDeLaRuta(
        fuente,
        parametros(request).slug,
        autenticacion.tenantId,
      )

      const usuarioId = leerUuid(
        parametros(request).id,
        'usuario',
        'El id del usuario no es válido.',
      )
      const password = leerPassword(leerCuerpo(request.body)['password'])

      // `scrypt` antes de abrir la transacción: no se retiene una conexión 50 ms por un hash.
      const passwordHash = await hashPassword(password)

      await enTransaccionDeTenant(fuente, tenant.id, async (conexion) => {
        const membresia = await buscarMembresia(conexion, usuarioId, tenant.id)
        if (membresia === undefined) throw validacion(MENSAJE_USUARIO_AJENO, 'usuario')

        // El propio password lo cambia cualquiera; el de otro, sólo quien tiene un rol
        // estrictamente mayor. Un `admin` no toca a otro `admin` ni al `owner`: si pudiera, se
        // quedaría con el rol de arriba. `sin_permiso` y no `validacion`: el pedido está bien
        // formado, lo que falta es permiso.
        const esPropia = usuarioId === autenticacion.usuarioId
        if (!esPropia && !rolSupera(autenticacion.rol, membresia)) {
          throw sinPermiso(MENSAJE_ROL_NO_ALCANZA)
        }

        const actualizado = await actualizarPassword(conexion, usuarioId, passwordHash)
        if (!actualizado) throw validacion(MENSAJE_USUARIO_INEXISTENTE, 'usuario')

        // La credencial vieja dejó de ser confiable: lo que se firmó con ella deja de servir. La
        // sesión propia se conserva cuando el actor resetea su propia contraseña, para no echarlo
        // de la pantalla que está usando.
        await revocarSesionesDeUsuario(
          conexion,
          usuarioId,
          esPropia ? autenticacion.tokenHash : undefined,
        )
      })

      return { ok: true }
    },
  )
}
