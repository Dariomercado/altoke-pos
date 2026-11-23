/**
 * Cliente HTTP de las rutas de sesión (`0003` §Auth): alta de tenant, login, `yo` y revocación.
 *
 * Igual que el transporte de sync, el cliente **no confía en el cable**: cada respuesta se valida
 * antes de devolverla y cada falla es un valor con su `motivo`, no una excepción que la pantalla
 * tenga que atrapar. El token viaja en `Authorization: Bearer` y el tenant elegido en `X-Tenant`;
 * con más de una membresía el servidor lo exige y no elige por el usuario.
 */

import { esRol } from './permisos.ts'
import type {
  DatosDeRegistro,
  Membresia,
  RespuestaSesion,
  RespuestaYo,
  Tenant,
  Usuario,
} from './tipos.ts'

export const RUTA_REGISTRO = '/auth/registro'
export const RUTA_SESION = '/auth/sesion'
export const RUTA_YO = '/auth/yo'

export const MENSAJE_SIN_SESION = 'Necesitás iniciar sesión.'
export const MENSAJE_SIN_PERMISO = 'No tenés permiso para esta acción.'
export const MENSAJE_SIN_RED = 'No se pudo hablar con el servidor.'
export const MENSAJE_RESPUESTA_INVALIDA = 'El servidor respondió algo que el contrato no acepta.'

export type MotivoDeErrorDeSesion =
  | 'no_autenticado'
  | 'sin_permiso'
  | 'validacion'
  | 'respuesta_invalida'
  | 'red'

export type ErrorDeSesion =
  | { readonly motivo: 'no_autenticado'; readonly mensaje: string }
  | { readonly motivo: 'sin_permiso'; readonly mensaje: string }
  | { readonly motivo: 'validacion'; readonly mensaje: string; readonly campo: string }
  | { readonly motivo: 'respuesta_invalida'; readonly mensaje: string }
  | { readonly motivo: 'red'; readonly mensaje: string }

export type ResultadoDeSesion<T> =
  | { readonly ok: true; readonly dato: T }
  | { readonly ok: false; readonly error: ErrorDeSesion }

export interface ClienteDeSesion {
  registro(datos: DatosDeRegistro): Promise<ResultadoDeSesion<RespuestaSesion>>
  iniciarSesion(email: string, password: string): Promise<ResultadoDeSesion<RespuestaSesion>>
  yo(token: string, tenantSlug?: string | undefined): Promise<ResultadoDeSesion<RespuestaYo>>
  /** Mejor esfuerzo: cerrar sesión local no puede quedar bloqueado por la red. */
  revocar(token: string): Promise<void>
}

export interface OpcionesClienteDeSesion {
  readonly baseUrl: string
  /** Inyectable: en la app es `globalThis.fetch`, en los tests un doble. */
  readonly fetch?: typeof fetch | undefined
}

type OpcionesPedido = {
  readonly metodo: 'GET' | 'POST' | 'DELETE'
  readonly token?: string | undefined
  readonly tenantSlug?: string | undefined
  readonly cuerpo?: unknown
}

export function crearClienteDeSesion(opciones: OpcionesClienteDeSesion): ClienteDeSesion {
  const base = opciones.baseUrl.replace(/\/+$/, '')
  const buscar = opciones.fetch ?? ((...argumentos) => globalThis.fetch(...argumentos))

  async function pedir(ruta: string, pedido: OpcionesPedido): Promise<ResultadoDeSesion<unknown>> {
    const cabeceras: Record<string, string> = { accept: 'application/json' }

    if (pedido.token !== undefined) cabeceras.authorization = `Bearer ${pedido.token}`
    if (pedido.tenantSlug !== undefined && pedido.tenantSlug.trim() !== '') {
      cabeceras['x-tenant'] = pedido.tenantSlug
    }
    if (pedido.cuerpo !== undefined) cabeceras['content-type'] = 'application/json'

    const init: RequestInit = { method: pedido.metodo, headers: cabeceras }
    if (pedido.cuerpo !== undefined) init.body = JSON.stringify(pedido.cuerpo)

    let respuesta: Response
    try {
      respuesta = await buscar(`${base}${ruta}`, init)
    } catch (error) {
      return { ok: false, error: { motivo: 'red', mensaje: mensajeDeRed(error) } }
    }

    const cuerpo = await leerJson(respuesta)
    if (!respuesta.ok) return { ok: false, error: errorDeEstado(respuesta.status, cuerpo) }

    return { ok: true, dato: cuerpo }
  }

  return {
    async registro(datos: DatosDeRegistro): Promise<ResultadoDeSesion<RespuestaSesion>> {
      const respuesta = await pedir(RUTA_REGISTRO, { metodo: 'POST', cuerpo: datos })
      if (!respuesta.ok) return respuesta

      const sesion = leerRespuestaSesion(respuesta.dato)
      return sesion === null ? respuestaInvalida() : { ok: true, dato: sesion }
    },

    async iniciarSesion(email: string, password: string): Promise<ResultadoDeSesion<RespuestaSesion>> {
      const respuesta = await pedir(RUTA_SESION, {
        metodo: 'POST',
        cuerpo: { email, password },
      })
      if (!respuesta.ok) return respuesta

      const sesion = leerRespuestaSesion(respuesta.dato)
      return sesion === null ? respuestaInvalida() : { ok: true, dato: sesion }
    },

    async yo(token: string, tenantSlug?: string | undefined): Promise<ResultadoDeSesion<RespuestaYo>> {
      const respuesta = await pedir(RUTA_YO, { metodo: 'GET', token, tenantSlug })
      if (!respuesta.ok) return respuesta

      const yo = leerRespuestaYo(respuesta.dato)
      return yo === null ? respuestaInvalida() : { ok: true, dato: yo }
    },

    async revocar(token: string): Promise<void> {
      // La sesión local ya se cierra aunque esto falle: la red no puede dejar las credenciales
      // abiertas en la terminal.
      await pedir(RUTA_SESION, { metodo: 'DELETE', token })
    },
  }
}

/** La API pública de `0003` §Infraestructura: la web vive en `slug.altoke.app` y la API en `api.` */
export const API_PUBLICA = 'https://api.altoke.app'

/**
 * En desarrollo la web no necesita archivo de entorno: el proxy de Vite (`vite.config.ts`) manda
 * `/api` al API local, así que un `pnpm dev` a secas ya habla con la base de tu máquina.
 */
export const RUTA_API_EN_DESARROLLO = '/api'

type EntornoDelCliente = Readonly<Record<string, string | boolean | undefined>>

/**
 * La API configurada por entorno.
 *
 * Sin `VITE_API_URL`, el default **depende del entorno**: en producción es el subdominio público y
 * en desarrollo es la ruta del proxy. Un solo default (el de producción) hacía que un `pnpm dev`
 * sin configurar nada mandara el login a `api.altoke.app` y el navegador lo mostrara como "no se
 * pudo hablar con el servidor", que es un error de red mentiroso: la API nunca estuvo en juego.
 */
export function baseUrlDesdeEntorno(env: EntornoDelCliente = entornoDeVite()): string {
  const configurada = leerTexto(env['VITE_API_URL'])
  if (configurada !== undefined) return configurada

  return env['DEV'] === true ? RUTA_API_EN_DESARROLLO : API_PUBLICA
}

function leerTexto(valor: string | boolean | undefined): string | undefined {
  if (typeof valor !== 'string') return undefined
  const recortado = valor.trim()

  return recortado === '' ? undefined : recortado
}

function entornoDeVite(): EntornoDelCliente {
  return (import.meta as ImportMeta & { readonly env?: EntornoDelCliente }).env ?? {}
}

function respuestaInvalida(): { readonly ok: false; readonly error: ErrorDeSesion } {
  return { ok: false, error: { motivo: 'respuesta_invalida', mensaje: MENSAJE_RESPUESTA_INVALIDA } }
}

type CuerpoDeError = {
  readonly code?: unknown
  readonly mensaje?: unknown
  readonly detalle?: { readonly campo?: unknown }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== ''
}

function esUsuario(valor: unknown): valor is Usuario {
  return (
    esObjeto(valor) &&
    esTexto(valor['id']) &&
    esTexto(valor['email']) &&
    esTexto(valor['nombre'])
  )
}

function esTenant(valor: unknown): valor is Tenant {
  return (
    esObjeto(valor) &&
    esTexto(valor['id']) &&
    esTexto(valor['slug']) &&
    esTexto(valor['nombre'])
  )
}

function esMembresia(valor: unknown): valor is Membresia {
  return (
    esObjeto(valor) &&
    esTexto(valor['tenantId']) &&
    esTexto(valor['slug']) &&
    esTexto(valor['nombre']) &&
    esRol(valor['rol'])
  )
}

function leerRespuestaSesion(cuerpo: unknown): RespuestaSesion | null {
  if (
    !esObjeto(cuerpo) ||
    !esTexto(cuerpo['token']) ||
    !esTexto(cuerpo['expiraEn']) ||
    !esUsuario(cuerpo['usuario']) ||
    !esTenant(cuerpo['tenant']) ||
    !esRol(cuerpo['rol'])
  ) {
    return null
  }

  return {
    token: cuerpo['token'],
    expiraEn: cuerpo['expiraEn'],
    usuario: cuerpo['usuario'],
    tenant: cuerpo['tenant'],
    rol: cuerpo['rol'],
  }
}

function leerRespuestaYo(cuerpo: unknown): RespuestaYo | null {
  if (!esObjeto(cuerpo) || !esUsuario(cuerpo['usuario'])) return null

  const membresias = cuerpo['membresias']
  if (!Array.isArray(membresias) || !membresias.every(esMembresia)) return null

  return { usuario: cuerpo['usuario'], membresias }
}

function leerJson(respuesta: Response): Promise<unknown> {
  return respuesta
    .json()
    .then((cuerpo: unknown) => cuerpo)
    .catch(() => undefined)
}

function cuerpoDeError(cuerpo: unknown): CuerpoDeError | null {
  if (!esObjeto(cuerpo) || !esObjeto(cuerpo['error'])) return null
  return cuerpo['error'] as CuerpoDeError
}

function mensajeDelCuerpo(cuerpo: CuerpoDeError | null, porDefecto: string): string {
  return esTexto(cuerpo?.mensaje) ? cuerpo.mensaje : porDefecto
}

function errorDeEstado(estado: number, cuerpoCrudo: unknown): ErrorDeSesion {
  const cuerpo = cuerpoDeError(cuerpoCrudo)
  const codigo = esTexto(cuerpo?.code) ? cuerpo.code : undefined

  if (codigo === 'no_autenticado' || estado === 401) {
    return { motivo: 'no_autenticado', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_SESION) }
  }
  if (
    codigo === 'sin_permiso' ||
    codigo === 'tenant_desconocido' ||
    estado === 403 ||
    estado === 404
  ) {
    return { motivo: 'sin_permiso', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_PERMISO) }
  }
  if (codigo === 'validacion' || estado === 400) {
    const campo = esTexto(cuerpo?.detalle?.campo) ? cuerpo.detalle.campo : 'cuerpo'
    return {
      motivo: 'validacion',
      mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_RESPUESTA_INVALIDA),
      campo,
    }
  }
  if (estado === 429 || estado >= 500) {
    return { motivo: 'red', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_RED) }
  }

  return { motivo: 'respuesta_invalida', mensaje: mensajeDelCuerpo(cuerpo, `HTTP ${estado}`) }
}

function mensajeDeRed(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? `${MENSAJE_SIN_RED} ${error.message}`
    : MENSAJE_SIN_RED
}
