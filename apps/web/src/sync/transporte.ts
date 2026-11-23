/**
 * El puerto de transporte al servidor (docs/specs/0001-arquitectura.md §4, `SyncTransport`) y su
 * adaptador `fetch` (`0003` §Sync).
 *
 * El puerto habla el contrato de `packages/contracts`, no una forma propia: empujar un lote de
 * eventos y traer una página desde un cursor. Las implementaciones son inyectables —los tests usan
 * un transporte falso y la app el adaptador `fetch`— y este módulo **no toca `window` al
 * importarse**: nada de `fetch` global capturado en una constante de módulo.
 *
 * Tres reglas del adaptador:
 *   - **El token viaja en `Authorization: Bearer`.** Sin token no se llama a la red: es
 *     `no_autenticado`, no un 401 que el usuario no puede distinguir de una sesión vencida.
 *   - **Nada del cable se cree.** Cada respuesta se valida con los parseos del contrato; lo que no
 *     valida es `respuesta_invalida`, no un objeto con forma rara.
 *   - **El error es un valor, no una excepción.** La UI ramifica sobre `motivo`; el adaptador nunca
 *     lanza por un 400, un 403 o una caída de red.
 */

import {
  parsearSyncEmpujarRespuesta,
  parsearSyncTraerRespuesta,
} from './contrato.ts'
import type {
  SyncEmpujarRespuesta,
  SyncEmpujarSolicitud,
  SyncTraerConsulta,
  SyncTraerRespuesta,
} from './contrato.ts'

/** Los motivos por los que una llamada de sync no devuelve datos. */
export type MotivoDeFallo =
  | 'no_autenticado'
  | 'sin_permiso'
  | 'validacion'
  | 'respuesta_invalida'
  | 'red'

export type ErrorDeTransporte =
  | { readonly motivo: 'no_autenticado'; readonly mensaje: string }
  | { readonly motivo: 'sin_permiso'; readonly mensaje: string }
  | { readonly motivo: 'validacion'; readonly mensaje: string; readonly campo: string }
  | { readonly motivo: 'respuesta_invalida'; readonly mensaje: string }
  | { readonly motivo: 'red'; readonly mensaje: string }

/** Resultado de una llamada de red: ni excepciones ni datos sin validar. */
export type ResultadoDeRed<T> =
  | { readonly ok: true; readonly dato: T }
  | { readonly ok: false; readonly error: ErrorDeTransporte }

/**
 * `POST /sync/eventos` con la adición documentada de `huecos`.
 *
 * El contrato de `packages/contracts` no puede declararla porque su `syncEmpujarRespuesta` es
 * común con la respuesta que valida el servidor; el README del API la documenta y el cliente la
 * valida aparte, sin confiar en ella.
 */
export type RespuestaDeEmpuje = SyncEmpujarRespuesta & { readonly huecos: readonly number[] }

/** El puerto: dos operaciones, las mismas formas que el contrato. */
export interface TransporteDeSync {
  empujar(solicitud: SyncEmpujarSolicitud): Promise<ResultadoDeRed<RespuestaDeEmpuje>>
  traer(consulta: SyncTraerConsulta): Promise<ResultadoDeRed<SyncTraerRespuesta>>
}

export const RUTA_EMPUJE = '/sync/eventos'
export const RUTA_TRAIDA = '/sync/eventos'

export const MENSAJE_SIN_SESION = 'Necesitás iniciar sesión.'
export const MENSAJE_SIN_PERMISO = 'No tenés permiso para sincronizar.'
export const MENSAJE_SIN_RED = 'No se pudo hablar con el servidor.'
export const MENSAJE_RESPUESTA_INVALIDA = 'El servidor respondió algo que el contrato no acepta.'
export const MENSAJE_VALIDACION = 'El servidor rechazó el pedido.'
export const MENSAJE_HUECOS_INVALIDOS =
  'huecos debe ser una lista de secuencias positivas.'

export interface OpcionesTransporteFetch {
  /** Origen de la API, sin barra final: `https://api.altoke.app`. */
  readonly baseUrl: string
  /** Token de la sesión vigente, o `null` si no hay. Se lee en cada llamada. */
  readonly token: () => string | null
  /**
   * `X-Tenant` (slug o id). Con más de una membresía el servidor lo exige y no elige al azar;
   * con una sola es opcional.
   */
  readonly tenantId?: string | undefined
  /** Inyectable: en la app es `globalThis.fetch`, en los tests un doble. */
  readonly fetch?: typeof fetch | undefined
}

export function crearTransporteFetch(opciones: OpcionesTransporteFetch): TransporteDeSync {
  const base = opciones.baseUrl.replace(/\/+$/, '')
  const buscar = opciones.fetch ?? ((...argumentos) => globalThis.fetch(...argumentos))

  function cabeceras(extra: Readonly<Record<string, string>> = {}): Record<string, string> | null {
    const token = opciones.token()
    if (token === null || token.trim() === '') return null

    const cabeceras: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...extra,
    }
    if (opciones.tenantId !== undefined) cabeceras['x-tenant'] = opciones.tenantId
    return cabeceras
  }

  /** Una llamada con el token puesto; el cuerpo se devuelve crudo para validarlo río arriba. */
  async function pedir(url: string, init: RequestInit): Promise<ResultadoDeRed<unknown>> {
    const cabecerasDelPedido = cabeceras((init.headers as Record<string, string> | undefined) ?? {})
    if (cabecerasDelPedido === null) {
      return { ok: false, error: { motivo: 'no_autenticado', mensaje: MENSAJE_SIN_SESION } }
    }

    let respuesta: Response
    try {
      respuesta = await buscar(url, { ...init, headers: cabecerasDelPedido })
    } catch (error) {
      return { ok: false, error: { motivo: 'red', mensaje: mensajeDeError(error) } }
    }

    const cuerpo = await leerJson(respuesta)
    if (!respuesta.ok) return { ok: false, error: errorDeEstado(respuesta.status, cuerpo) }

    return { ok: true, dato: cuerpo }
  }

  return {
    async empujar(solicitud: SyncEmpujarSolicitud): Promise<ResultadoDeRed<RespuestaDeEmpuje>> {
      const pedido = await pedir(`${base}${RUTA_EMPUJE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(solicitud),
      })
      if (!pedido.ok) return pedido

      const validado = parsearSyncEmpujarRespuesta(pedido.dato)
      if (!validado.ok) {
        return { ok: false, error: respuestaInvalida(validado.error.error.mensaje) }
      }

      const huecos = leerHuecos(pedido.dato)
      if (huecos === null) return { ok: false, error: respuestaInvalida(MENSAJE_HUECOS_INVALIDOS) }

      return { ok: true, dato: { ...validado.dato, huecos } }
    },

    async traer(consulta: SyncTraerConsulta): Promise<ResultadoDeRed<SyncTraerRespuesta>> {
      const url = new URL(`${base}${RUTA_TRAIDA}`)
      url.searchParams.set('terminalId', consulta.terminalId)
      url.searchParams.set('desde', consulta.desde)

      const pedido = await pedir(url.toString(), { method: 'GET' })
      if (!pedido.ok) return pedido

      const validado = parsearSyncTraerRespuesta(pedido.dato)
      if (!validado.ok) {
        return { ok: false, error: respuestaInvalida(validado.error.error.mensaje) }
      }

      return { ok: true, dato: validado.dato }
    },
  }
}

function respuestaInvalida(detalle: string): ErrorDeTransporte {
  return { motivo: 'respuesta_invalida', mensaje: `${MENSAJE_RESPUESTA_INVALIDA} ${detalle}` }
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? `${MENSAJE_SIN_RED} ${error.message}`
    : MENSAJE_SIN_RED
}

async function leerJson(respuesta: Response): Promise<unknown> {
  try {
    return await respuesta.json()
  } catch {
    // Un cuerpo que no es JSON es `respuesta_invalida` (o `red` si el estado lo dice), no una
    // excepción que la pantalla tenga que atrapar.
    return undefined
  }
}

type CuerpoDeError = {
  readonly code?: unknown
  readonly mensaje?: unknown
  readonly detalle?: { readonly campo?: unknown }
}

function cuerpoDeError(cuerpo: unknown): CuerpoDeError | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const error = (cuerpo as { readonly error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  return error as CuerpoDeError
}

function mensajeDelCuerpo(cuerpo: CuerpoDeError | null, porDefecto: string): string {
  return typeof cuerpo?.mensaje === 'string' && cuerpo.mensaje.trim() !== ''
    ? cuerpo.mensaje
    : porDefecto
}

/** Traduce el estado HTTP a un motivo que la UI puede ramificar. */
function errorDeEstado(estado: number, cuerpoCrudo: unknown): ErrorDeTransporte {
  const cuerpo = cuerpoDeError(cuerpoCrudo)
  const codigo = typeof cuerpo?.code === 'string' ? cuerpo.code : undefined

  if (codigo === 'no_autenticado' || estado === 401) {
    return { motivo: 'no_autenticado', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_SESION) }
  }
  if (codigo === 'sin_permiso' || estado === 403) {
    return { motivo: 'sin_permiso', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_PERMISO) }
  }
  if (codigo === 'validacion' || estado === 400) {
    const campo = typeof cuerpo?.detalle?.campo === 'string' ? cuerpo.detalle.campo : 'cuerpo'
    return {
      motivo: 'validacion',
      mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_VALIDACION),
      campo,
    }
  }

  // 429 y 5xx son transitorios: el backoff puede reintentar. Cualquier otro estado no se explica
  // con un contrato que el cliente conozca, y se trata como respuesta inválida.
  if (estado === 429 || estado >= 500) {
    return { motivo: 'red', mensaje: mensajeDelCuerpo(cuerpo, MENSAJE_SIN_RED) }
  }

  return respuestaInvalida(mensajeDelCuerpo(cuerpo, `HTTP ${estado}`))
}

/**
 * `huecos` es una adición del API, así que no la valida el contrato: se valida acá.
 *
 * Ausente vale lista vacía —un servidor viejo no reporta huecos— pero un valor presente que no sea
 * una lista de secuencias positivas se rechaza entero. Inventar una secuencia a partir de un
 * `"2"` textual sería reenviar lo que no falta.
 */
function leerHuecos(cuerpo: unknown): readonly number[] | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const valor = (cuerpo as { readonly huecos?: unknown }).huecos
  if (valor === undefined) return []
  if (!Array.isArray(valor)) return null

  const huecos: number[] = []
  for (const candidato of valor) {
    if (typeof candidato !== 'number' || !Number.isInteger(candidato) || candidato <= 0) return null
    huecos.push(candidato)
  }
  return huecos
}
