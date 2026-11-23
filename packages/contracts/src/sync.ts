/**
 * Contrato de sync entre la terminal y el servidor (docs/specs/0003-api-y-sync.md §Sync).
 *
 * La semántica es la misma de los dos lados y no depende de relojes: **la cola de sync es "eventos
 * con secuencia mayor al último acuse"** (`0001` §I2). El único tiempo que ordena es `recibidoEn`
 * del servidor, y viaja como cursor opaco en `desde`.
 *
 * Acá viven las formas y los parseos; la idempotencia por `(tenant, terminal, secuencia)`, el RLS y
 * las respuestas son de `apps/api` (T5). El contrato no sabe de HTTP.
 */

import { z } from 'zod'
import { enteroNoNegativo, enteroPositivo, texto } from './campos.ts'
import { esquemaEvento } from './eventos.ts'
import { parsear } from './parseo.ts'
import type { Resultado } from './errores.ts'

/** Hasta dónde llegó el servidor con esa terminal. Cero es legítimo: nunca recibió nada. */
const acuse = z.object({
  terminalId: texto('terminalId'),
  ultimaSecuencia: enteroNoNegativo('ultimaSecuencia'),
})

/** Lo mínimo para identificar un evento ya visto por el servidor. */
const referencia = z.object({ id: texto('id'), secuencia: enteroPositivo('secuencia') })

/** `POST /sync/eventos` */
export const syncEmpujarSolicitud = z.object({
  terminalId: texto('terminalId'),
  /**
   * Una lista vacía **no es un no-op**: es un cliente que cree tener algo que empujar y no lo
   * tiene. Aceptarla como éxito esconde el bug del lado de la terminal hasta que falte un evento.
   */
  eventos: z
    .array(esquemaEvento, { error: 'eventos debe ser una lista de eventos.' })
    .min(1, {
      error: 'La solicitud no trae eventos: empujar una lista vacía no es un no-op.',
    }),
})

export type SyncEmpujarSolicitud = z.infer<typeof syncEmpujarSolicitud>

/**
 * Respuesta de `POST /sync/eventos`: las cuatro listas que pide el spec y el acuse.
 *
 * Ninguna lista exige contenido: un empuje todo aceptado no tiene duplicados, conflictos ni
 * rechazos, y el servidor no inventa entradas para llenarlas.
 */
export const syncEmpujarRespuesta = z.object({
  aceptados: z.array(referencia, { error: 'aceptados debe ser una lista.' }),
  duplicados: z.array(referencia, { error: 'duplicados debe ser una lista.' }),
  conflictos: z.array(
    z.object({
      id: texto('id'),
      secuencia: enteroPositivo('secuencia'),
      motivo: texto('motivo'),
    }),
    { error: 'conflictos debe ser una lista.' },
  ),
  rechazados: z.array(z.object({ id: texto('id'), motivo: texto('motivo') }), {
    error: 'rechazados debe ser una lista.',
  }),
  acuse,
})

export type SyncEmpujarRespuesta = z.infer<typeof syncEmpujarRespuesta>

/** `GET /sync/eventos?terminalId=...&desde=<recibidoEn ISO>` */
export const syncTraerConsulta = z.object({
  terminalId: texto('terminalId'),
  desde: z.iso.datetime({
    error: 'desde debe ser una fecha ISO-8601: es el cursor de tiempo del servidor.',
  }),
})

export type SyncTraerConsulta = z.infer<typeof syncTraerConsulta>

/**
 * Respuesta de `GET /sync/eventos`.
 *
 * `hayMas` ausente vale `false` y nada más: un `"true"` en texto no se coacciona. Una respuesta
 * vieja sin el campo significa "no hay más" sólo si el campo no vino; adivinar con coerción
 * haría que un `"false"` textual se leyera como paginación pendiente para siempre.
 *
 * `siguienteDesde` es el `desde` exacto con el que se pide la página siguiente, **o `null`** cuando
 * no hay nada más. Es obligatorio y no se deriva del último evento: el cliente no tiene por qué
 * reimplementar el cursor (y una página vacía o de borde lo dejaría sin nada sobre lo que apoyarse).
 * Viaja como `null` explícito y no como ausente porque "el campo no vino" es exactamente la
 * ambigüedad que `hayMas` ya paga: con el cursor, un ausente se leería como "no pidas más" y el
 * cliente se quedaría con eventos sin traer.
 */
export const syncTraerRespuesta = z.object({
  eventos: z.array(esquemaEvento, { error: 'eventos debe ser una lista de eventos.' }),
  acuse,
  hayMas: z.boolean({ error: 'hayMas tiene que ser booleano.' }).default(false),
  siguienteDesde: z
    .iso.datetime({ error: 'siguienteDesde debe ser una fecha ISO-8601 o null.' })
    .nullable(),
})

export type SyncTraerRespuesta = z.infer<typeof syncTraerRespuesta>

export function parsearSyncEmpujarSolicitud(valor: unknown): Resultado<SyncEmpujarSolicitud> {
  return parsear(syncEmpujarSolicitud, valor)
}

export function parsearSyncEmpujarRespuesta(valor: unknown): Resultado<SyncEmpujarRespuesta> {
  return parsear(syncEmpujarRespuesta, valor)
}

export function parsearSyncTraerConsulta(valor: unknown): Resultado<SyncTraerConsulta> {
  return parsear(syncTraerConsulta, valor)
}

export function parsearSyncTraerRespuesta(valor: unknown): Resultado<SyncTraerRespuesta> {
  return parsear(syncTraerRespuesta, valor)
}
