/**
 * Dobles de test del módulo de sesión. No es código de producción: la app no importa este archivo.
 *
 * La forma es la misma que `sync/dobles.ts`: el estado del almacén a la vista para afirmar qué
 * quedó persistido y la lista de llamadas para afirmar que una acción llegó al servidor (o que no).
 */

import type { AlmacenDeSesion } from './almacen.ts'
import type { ClienteDeSesion, ResultadoDeSesion } from './cliente.ts'
import type {
  DatosDeRegistro,
  Membresia,
  RespuestaSesion,
  RespuestaYo,
  SesionActiva,
  Tenant,
  Usuario,
} from './tipos.ts'

export const USUARIO_DE_PRUEBA: Usuario = {
  id: 'usuario-1',
  email: 'duena@kiosco.test',
  nombre: 'Dueña',
}

export const TENANT_DE_PRUEBA: Tenant = {
  id: 'kiosco-1',
  slug: 'kiosco-1',
  nombre: 'AlToke · Kiosco demo',
}

export const MEMBRESIA_DE_PRUEBA: Membresia = {
  tenantId: TENANT_DE_PRUEBA.id,
  slug: TENANT_DE_PRUEBA.slug,
  nombre: TENANT_DE_PRUEBA.nombre,
  rol: 'owner',
}

export const SESION_DE_PRUEBA: SesionActiva = {
  token: 'token-de-prueba',
  usuario: USUARIO_DE_PRUEBA,
  tenant: TENANT_DE_PRUEBA,
  rol: 'owner',
}

export const EXPIRA_EN_DE_PRUEBA = '2026-11-23T22:00:00.000Z'

export function respuestaSesionDePrueba(resto: Partial<RespuestaSesion> = {}): RespuestaSesion {
  return {
    token: SESION_DE_PRUEBA.token,
    expiraEn: EXPIRA_EN_DE_PRUEBA,
    usuario: SESION_DE_PRUEBA.usuario,
    tenant: SESION_DE_PRUEBA.tenant,
    rol: SESION_DE_PRUEBA.rol,
    ...resto,
  }
}

export interface EstadoDelAlmacenDePrueba {
  valor: SesionActiva | null
  borrados: number
}

export function almacenDeSesionEnMemoria(inicial: SesionActiva | null = null): {
  readonly almacen: AlmacenDeSesion
  readonly estado: EstadoDelAlmacenDePrueba
} {
  const estado: EstadoDelAlmacenDePrueba = { valor: inicial, borrados: 0 }

  return {
    estado,
    almacen: {
      async leer() {
        return estado.valor
      },
      async guardar(sesion) {
        estado.valor = sesion
      },
      async borrar() {
        estado.valor = null
        estado.borrados += 1
      },
    },
  }
}

type GuionDeSesion = (
  email: string,
  password: string,
) => ResultadoDeSesion<RespuestaSesion> | Promise<ResultadoDeSesion<RespuestaSesion>>

type GuionDeRegistro = (
  datos: DatosDeRegistro,
) => ResultadoDeSesion<RespuestaSesion> | Promise<ResultadoDeSesion<RespuestaSesion>>

type GuionDeYo = (
  token: string,
  tenantSlug: string | undefined,
) => ResultadoDeSesion<RespuestaYo> | Promise<ResultadoDeSesion<RespuestaYo>>

export interface GuionesDeClienteDeSesion {
  readonly registro?: GuionDeRegistro | undefined
  readonly iniciarSesion?: GuionDeSesion | undefined
  readonly yo?: GuionDeYo | undefined
  readonly revocar?: ((token: string) => void | Promise<void>) | undefined
}

export interface LlamadasDelCliente {
  readonly registros: DatosDeRegistro[]
  readonly sesiones: { readonly email: string; readonly password: string }[]
  readonly yos: { readonly token: string; readonly tenantSlug: string | undefined }[]
  readonly revocaciones: string[]
}

export function clienteDeSesionDePrueba(
  guiones: GuionesDeClienteDeSesion = {},
): ClienteDeSesion & { readonly llamadas: LlamadasDelCliente } {
  const llamadas: LlamadasDelCliente = {
    registros: [],
    sesiones: [],
    yos: [],
    revocaciones: [],
  }

  return {
    llamadas,
    async registro(datos) {
      llamadas.registros.push(datos)
      if (guiones.registro !== undefined) return guiones.registro(datos)

      return {
        ok: true,
        dato: respuestaSesionDePrueba({
          tenant: { id: 'tenant-nuevo', slug: datos.tenant.slug, nombre: datos.tenant.nombre },
        }),
      }
    },
    async iniciarSesion(email, password) {
      llamadas.sesiones.push({ email, password })
      if (guiones.iniciarSesion !== undefined) return guiones.iniciarSesion(email, password)

      return { ok: true, dato: respuestaSesionDePrueba() }
    },
    async yo(token, tenantSlug) {
      llamadas.yos.push({ token, tenantSlug })
      if (guiones.yo !== undefined) return guiones.yo(token, tenantSlug)

      return {
        ok: true,
        dato: { usuario: USUARIO_DE_PRUEBA, membresias: [MEMBRESIA_DE_PRUEBA] },
      }
    },
    async revocar(token) {
      llamadas.revocaciones.push(token)
      if (guiones.revocar !== undefined) await guiones.revocar(token)
    },
  }
}
