/**
 * La forma única de error de docs/specs/0003-api-y-sync.md §Errores:
 *
 *     { error: { code, mensaje, detalle? } }
 *
 * Nada de stack traces al cliente: el detalle queda en el log del servidor. Los códigos que el
 * spec nombra son los del cliente; `error_interno` y `no_encontrado` existen para que incluso un
 * 500 o una ruta inexistente respondan con la misma forma, en vez de la forma por defecto de
 * Fastify. Una respuesta con dos formas distintas obliga al cliente a adivinar.
 */

import type { FastifyInstance } from 'fastify'

/** Los códigos de 0003 §Errores, más los dos que sólo puede emitir el propio servidor. */
export type CodigoError =
  | 'no_autenticado'
  | 'sin_permiso'
  | 'tenant_desconocido'
  | 'validacion'
  | 'conflicto_de_secuencia'
  | 'demasiados_intentos'
  | 'error_interno'
  | 'no_encontrado'

export type DetalleError = Readonly<Record<string, unknown>>

export class ErrorApi extends Error {
  readonly codigo: CodigoError
  readonly estado: number
  readonly detalle: DetalleError | undefined

  constructor(codigo: CodigoError, estado: number, mensaje: string, detalle?: DetalleError) {
    super(mensaje)
    this.name = 'ErrorApi'
    this.codigo = codigo
    this.estado = estado
    this.detalle = detalle
  }
}

export const MENSAJE_SIN_SESION = 'Necesitás iniciar sesión.'

export function noAutenticado(mensaje: string = MENSAJE_SIN_SESION): ErrorApi {
  return new ErrorApi('no_autenticado', 401, mensaje)
}

export function sinPermiso(mensaje: string = 'No tenés permiso para esta acción.'): ErrorApi {
  return new ErrorApi('sin_permiso', 403, mensaje)
}

export function tenantDesconocido(): ErrorApi {
  return new ErrorApi('tenant_desconocido', 404, 'Ese tenant no existe.')
}

/** `campo` nombra el campo que falló: el cliente puede señalar el input sin adivinar. */
export function validacion(mensaje: string, campo?: string): ErrorApi {
  return new ErrorApi('validacion', 400, mensaje, campo === undefined ? undefined : { campo })
}

export function demasiadosIntentos(mensaje = 'Demasiados intentos. Probá más tarde.'): ErrorApi {
  return new ErrorApi('demasiados_intentos', 429, mensaje)
}

type CuerpoDeError = {
  readonly error: {
    readonly code: CodigoError
    readonly mensaje: string
    readonly detalle?: DetalleError
  }
}

function cuerpo(error: ErrorApi): CuerpoDeError {
  const base = { code: error.codigo, mensaje: error.message }
  // El `detalle` es opcional y no viaja como `undefined`: la forma se mantiene, la clave no
  // aparece si no hay nada que decir.
  return { error: error.detalle === undefined ? base : { ...base, detalle: error.detalle } }
}

/**
 * El handler de Fastify tipa `error` como `unknown`. Un error de transporte (JSON malformado,
 * cuerpo enorme) trae `statusCode` 4xx; cualquier otra cosa es una falla del servidor.
 */
function estadoDelError(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const estado = (error as { statusCode?: unknown }).statusCode
    if (typeof estado === 'number') return estado
  }
  return 500
}

export function registrarManejadoresDeError(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ErrorApi) {
      request.log.info({ codigo: error.codigo, detalle: error.detalle }, 'pedido rechazado')
      reply.status(error.estado).send(cuerpo(error))
      return
    }

    const estado = estadoDelError(error)

    // Un JSON malformado, un cuerpo enorme o un content-type raro son input del cliente, no una
    // falla del servidor: se responden con la forma común y no con el 400 por defecto de Fastify.
    if (estado >= 400 && estado < 500) {
      reply.status(estado).send({
        error: { code: 'validacion', mensaje: 'El pedido no se pudo leer.' },
      } satisfies CuerpoDeError)
      return
    }

    // El detalle (incluido el stack) se queda en el log. El cliente ve un 500 y nada más.
    request.log.error({ err: error }, 'error inesperado')
    reply
      .status(500)
      .send({ error: { code: 'error_interno', mensaje: 'Error interno.' } } satisfies CuerpoDeError)
  })

  app.setNotFoundHandler((_request, reply) => {
    reply
      .status(404)
      .send({ error: { code: 'no_encontrado', mensaje: 'Esa ruta no existe.' } } satisfies CuerpoDeError)
  })
}
