/**
 * Sync entre terminales (docs/specs/0003-api-y-sync.md §Sync, tarea T5):
 *
 *   POST /sync/eventos   { terminalId, eventos: Evento[] }   (cajero | admin | owner)
 *   GET  /sync/eventos?terminalId=...&desde=<ISO>            (cualquier rol, incluido solo_lectura)
 *
 * Tres reglas mandan sobre el resto:
 *
 *   - **El tenant sale de la sesión, nunca del cuerpo.** El `tenantId` del evento y el
 *     `terminalId` del sobre se comprueban contra la sesión; un evento que declara otro tenant se
 *     rechaza y jamás se escribe. Un `terminalId` inventado sólo puede escribir dentro del tenant
 *     de quien lo manda (no hay tabla `terminales` en 0003 §Esquema: el id lo lleva el cliente).
 *   - **`servidor` no es una caja.** Es la identidad reservada de los eventos que emite el servidor
 *     (`sobreventa_detectada`), con su propia secuencia: un cliente no puede empujar con ese
 *     `terminalId` ni escribir un tipo de `TIPOS_DEL_SERVIDOR` (`validarEventoDeCliente`).
 *   - **Un evento malo no aborta el lote.** Se reporta en `rechazados` con su motivo y sus hermanos
 *     se escriben: el objetivo del sync es que la terminal no pierda ventas, no castigar el lote.
 *   - **Nada se reescribe.** Idempotencia y conflictos los arbitra la base (`eventos.ts`); acá sólo
 *     se arma el informe. La detección de sobreventa corre en la misma transacción (`sobreventas.ts`).
 *
 * El sobre se valida a mano y **evento por evento** con los schemas de `@altoke/contracts`: parsear
 * la solicitud entera con `syncEmpujarSolicitud` respondería 400 al primer evento inválido y se
 * llevaría puesto al resto del lote, que es exactamente lo que la regla anterior prohíbe.
 */

import type { FastifyInstance } from 'fastify'
import {
  parsear,
  parsearEvento,
  parsearSyncEmpujarRespuesta,
  parsearSyncTraerRespuesta,
  syncTraerConsulta,
} from '@altoke/contracts'
import type { SyncEmpujarRespuesta } from '@altoke/contracts'
import { TERMINAL_DEL_SERVIDOR, migrarEvento, validarEventoDeCliente } from '@altoke/domain'
import type { Evento } from '@altoke/domain'
import type { Consultable, FuenteDeConexiones } from './db.ts'
import { autenticacionDe, autenticar, requiereRol } from './auth.ts'
import { validacion } from './errores.ts'
import {
  acuseDeTerminal,
  guardarEvento,
  registrarAcuse,
  traerEventos,
} from './eventos.ts'
import type { Conflicto, Referencia } from './eventos.ts'
import { bloquearSobreventas, detectarSobreventa } from './sobreventas.ts'
import { enTransaccionDeTenant } from './transaccion.ts'
import { leerCuerpo } from './validacion.ts'

/** `terminalId` lo lleva el cliente; el tope evita que un id absurdo se vuelva una clave de tabla. */
export const LARGO_MAXIMO_TERMINAL = 64
export const MENSAJE_TERMINAL_INVALIDO =
  'terminalId debe ser un texto no vacío de hasta 64 caracteres.'
export const MENSAJE_TERMINAL_RESERVADA =
  `terminalId "${TERMINAL_DEL_SERVIDOR}" está reservado para los eventos del servidor.`

// Mensajes del contrato (`packages/contracts/src/sync.ts`): el sobre se arma con los mismos textos
// que vería un cliente que validara con `syncEmpujarSolicitud`.
export const MENSAJE_EVENTOS_NO_ES_LISTA = 'eventos debe ser una lista de eventos.'
export const MENSAJE_SIN_EVENTOS =
  'La solicitud no trae eventos: empujar una lista vacía no es un no-op.'

/** Por qué un evento bien formado no se escribe. Los dos son rechazos, no conflictos. */
export const MENSAJE_TENANT_AJENO = 'El evento declara otro tenant que el de la sesión.'
export const MENSAJE_TERMINAL_AJENA = 'El evento declara otra terminal que la del pedido.'
export const MENSAJE_SECUENCIA_NO_SEGURA =
  'secuencia no es un entero positivo representable.'

type EventoCrudo = unknown

type Lote = {
  readonly terminalId: string
  readonly eventos: readonly EventoCrudo[]
}

type Rechazo = { readonly id: string; readonly motivo: string }

/** Listas mutables: son las que el contrato (`SyncEmpujarRespuesta`) declara y las que se llenan acá. */
type InformeDeEmpuje = {
  readonly aceptados: Referencia[]
  readonly duplicados: Referencia[]
  readonly conflictos: Conflicto[]
  readonly rechazados: Rechazo[]
}

function leerTerminalId(valor: unknown): string {
  if (typeof valor !== 'string') throw validacion(MENSAJE_TERMINAL_INVALIDO, 'terminalId')
  if (valor.trim() === '' || valor.length > LARGO_MAXIMO_TERMINAL) {
    throw validacion(MENSAJE_TERMINAL_INVALIDO, 'terminalId')
  }
  // La identidad del servidor no se pide ni se empuja: sus eventos los escribe el servidor.
  if (valor === TERMINAL_DEL_SERVIDOR) {
    throw validacion(MENSAJE_TERMINAL_RESERVADA, 'terminalId')
  }
  return valor
}

function leerEmpuje(cuerpo: unknown): Lote {
  const datos = leerCuerpo(cuerpo)
  const terminalId = leerTerminalId(datos['terminalId'])
  const eventos = datos['eventos']

  if (!Array.isArray(eventos)) throw validacion(MENSAJE_EVENTOS_NO_ES_LISTA, 'eventos')
  if (eventos.length === 0) throw validacion(MENSAJE_SIN_EVENTOS, 'eventos')

  return { terminalId, eventos }
}

/**
 * `desde` es opcional: ausente significa "desde el principio". Cuando viene, lo valida el schema del
 * contrato (`syncTraerConsulta`), así el mensaje y el `detalle.campo` son los mismos que vería un
 * cliente que validara la consulta entera.
 */
function leerConsultaTraida(valor: unknown): { terminalId: string; desde: string | undefined } {
  if (typeof valor !== 'object' || valor === null) {
    throw validacion(MENSAJE_TERMINAL_INVALIDO, 'terminalId')
  }
  const consulta = valor as Record<string, unknown>
  const terminalId = leerTerminalId(consulta['terminalId'])
  const crudo = consulta['desde']

  if (crudo === undefined) return { terminalId, desde: undefined }

  // El schema entero y no sólo el campo `desde`: un `detalle.campo` vacío se leería como `cuerpo`
  // y el cliente no sabría qué corregir. Con la consulta completa, el camino es `desde`.
  const desde = parsear(syncTraerConsulta, { terminalId, desde: crudo })
  if (!desde.ok) throw validacion(desde.error.error.mensaje, desde.error.error.detalle.campo)
  return { terminalId: desde.dato.terminalId, desde: desde.dato.desde }
}

/** Un rechazo sin `id` utilizable se identifica por su lugar en el lote: el cliente puede señalarlo. */
function idDeRechazo(crudo: EventoCrudo, indice: number): string {
  const id = (crudo as { readonly id?: unknown } | null | undefined)?.id
  return typeof id === 'string' && id.trim() !== '' ? id : `eventos.${indice}`
}

function motivoDeError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'El evento no es válido.'
}

/** Un evento que puede haber dejado el stock bajo cero: es el único que resta unidades de una venta. */
function puedeMoverStock(crudo: EventoCrudo): boolean {
  const tipo = (crudo as { readonly tipo?: unknown } | null | undefined)?.tipo
  return tipo === 'item_agregado'
}

/**
 * Escribe lo que se pueda y devuelve el informe. Nunca lanza por un evento inválido, conflictivo o
 * duplicado: eso es información para la terminal, no un error del servidor.
 */
async function empujarLote(
  conexion: Consultable,
  tenantId: string,
  lote: Lote,
): Promise<InformeDeEmpuje> {
  const aceptados: Referencia[] = []
  const duplicados: Referencia[] = []
  const conflictos: Conflicto[] = []
  const rechazados: Rechazo[] = []

  // Antes de escribir nada: si el lote trae ítems de venta, el chequeo de sobreventa se serializa
  // por tenant. Dos terminales que venden la última unidad a la vez tienen que ver, la segunda, la
  // venta de la primera ya escrita; si no, el stock queda negativo y ninguna alerta lo cuenta.
  if (lote.eventos.some(puedeMoverStock)) {
    await bloquearSobreventas(conexion, tenantId)
  }

  for (const [indice, crudo] of lote.eventos.entries()) {
    // 0003 §schemaVersion: la cadena compartida corre **antes** de validar, así un cuerpo de una
    // versión vieja se juzga con las reglas de hoy. Con la cadena vacía de M2 el cuerpo que se
    // escribe es idéntico al que declaró la terminal —por eso reintentarlo es `duplicado` y no
    // `conflicto`— y ninguna fila existente se reescribe: `guardarEvento` sólo inserta.
    let migrado: Evento
    try {
      migrado = migrarEvento(crudo)
    } catch (error) {
      rechazados.push({ id: idDeRechazo(crudo, indice), motivo: motivoDeError(error) })
      continue
    }

    const parseado = parsearEvento(migrado)
    if (!parseado.ok) {
      rechazados.push({ id: idDeRechazo(crudo, indice), motivo: parseado.error.error.mensaje })
      continue
    }

    const evento = parseado.dato

    // La sesión manda: el sobre y el cuerpo tienen que hablar de esta terminal y de este tenant.
    if (evento.tenantId !== tenantId) {
      rechazados.push({ id: evento.id, motivo: MENSAJE_TENANT_AJENO })
      continue
    }
    if (evento.terminalId !== lote.terminalId) {
      rechazados.push({ id: evento.id, motivo: MENSAJE_TERMINAL_AJENA })
      continue
    }
    // `bigint` en Postgres no llega tan lejos como un `number`: un valor inseguro sería un 500.
    if (!Number.isSafeInteger(evento.secuencia)) {
      rechazados.push({ id: evento.id, motivo: MENSAJE_SECUENCIA_NO_SEGURA })
      continue
    }

    try {
      // El borde del cliente: además de la forma, que no escriba lo que sólo emite el servidor.
      validarEventoDeCliente(evento)
    } catch (error) {
      rechazados.push({ id: evento.id, motivo: motivoDeError(error) })
      continue
    }

    const guardado = await guardarEvento(conexion, tenantId, evento)
    const referencia = { id: evento.id, secuencia: evento.secuencia }

    if (guardado.tipo === 'aceptado') {
      aceptados.push(referencia)
      // Sólo un evento aceptado puede haber cambiado el stock: un duplicado ya fue detectado
      // cuando entró, y un conflicto no escribe nada.
      await detectarSobreventa(conexion, tenantId, evento)
    } else if (guardado.tipo === 'duplicado') duplicados.push(referencia)
    else conflictos.push({ ...referencia, motivo: guardado.motivo })
  }

  return { aceptados, duplicados, conflictos, rechazados }
}

/** Una respuesta que el contrato no acepte es un bug del servidor: 500, nunca un cuerpo raro. */
function asegurarEmpuje(respuesta: SyncEmpujarRespuesta): void {
  const resultado = parsearSyncEmpujarRespuesta(respuesta)
  if (!resultado.ok) {
    throw new Error(`sync: la respuesta del empuje no cumple el contrato (${resultado.error.error.mensaje})`)
  }
}

export function registrarRutasSync(app: FastifyInstance, fuente: FuenteDeConexiones): void {
  app.post(
    '/sync/eventos',
    { preHandler: [autenticar(fuente), requiereRol('cajero', 'admin', 'owner')] },
    async (request, reply) => {
      const autenticacion = autenticacionDe(request)
      const lote = leerEmpuje(request.body)

      const respuesta = await enTransaccionDeTenant(
        fuente,
        autenticacion.tenantId,
        async (conexion) => {
          const informe = await empujarLote(conexion, autenticacion.tenantId, lote)
          const acuse = await acuseDeTerminal(conexion, autenticacion.tenantId, lote.terminalId)
          // El acuse guardado nunca retrocede: es lo que la terminal lee para dejar de reenviar.
          await registrarAcuse(
            conexion,
            autenticacion.tenantId,
            lote.terminalId,
            acuse.ultimaSecuencia,
          )

          return {
            ...informe,
            acuse: { terminalId: lote.terminalId, ultimaSecuencia: acuse.ultimaSecuencia },
            // Adición documentada en el README: los huecos que la terminal todavía debe.
            huecos: acuse.huecos,
          }
        },
      )

      const { huecos, ...contrato } = respuesta
      asegurarEmpuje(contrato)

      return reply.status(200).send({ ...contrato, huecos })
    },
  )

  app.get('/sync/eventos', { preHandler: autenticar(fuente) }, async (request) => {
    const autenticacion = autenticacionDe(request)
    const consulta = leerConsultaTraida(request.query)

    const respuesta = await enTransaccionDeTenant(
      fuente,
      autenticacion.tenantId,
      async (conexion) => {
        const traida = await traerEventos(conexion, {
          tenantId: autenticacion.tenantId,
          terminalId: consulta.terminalId,
          desde: consulta.desde,
        })
        // Sólo lectura: el `GET` no escribe el acuse (un rol de sólo lectura no escribe nada).
        const acuse = await acuseDeTerminal(conexion, autenticacion.tenantId, consulta.terminalId)

        return {
          eventos: traida.eventos,
          acuse: { terminalId: consulta.terminalId, ultimaSecuencia: acuse.ultimaSecuencia },
          hayMas: traida.hayMas,
          siguienteDesde: traida.siguienteDesde,
        }
      },
    )

    const validado = parsearSyncTraerRespuesta(respuesta)
    if (!validado.ok) {
      throw new Error(
        `sync: la respuesta de la traída no cumple el contrato (${validado.error.error.mensaje})`,
      )
    }

    return respuesta
  })
}
