/**
 * La cola de sync, derivada del libro y del último acuse (docs/specs/0001-arquitectura.md §I2,
 * `0003` §Sync).
 *
 * **No hay una segunda cola.** La cola es literalmente "eventos de esta terminal con secuencia
 * mayor al último acuse del servidor": si se guardara aparte, podría discrepar del libro y una
 * venta quedaría sin subir (o se subiría dos veces) sin que nadie lo note. Por eso acá sólo hay una
 * función pura sobre el libro y un lector que pregunta al store por el rango pendiente.
 */

import type { Evento } from '@altoke/domain'
import type { PosStore } from '@altoke/store'

/** Una secuencia acusada tiene que ser una secuencia: entera, no negativa y representable. */
export function validarSecuenciaAcusada(secuencia: number): void {
  if (!Number.isInteger(secuencia) || secuencia < 0 || secuencia >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Secuencia acusada inválida: ${secuencia}`)
  }
}

/**
 * Eventos de `terminalId` posteriores al acuse, en orden y sin repetir `id`.
 *
 * El orden es de **secuencia**, no de fecha: dos terminales comparten el libro pero el rango de
 * secuencia de una terminal es suyo, y el servidor arbitra por `(tenant, terminal, secuencia)`
 * (`0001` §2).
 */
export function colaDeSync(
  eventos: readonly Evento[],
  terminalId: string,
  ultimaSecuenciaAcusada: number,
): Evento[] {
  validarSecuenciaAcusada(ultimaSecuenciaAcusada)

  const vistos = new Set<string>()
  const cola: Evento[] = []

  for (const evento of eventos) {
    if (evento.terminalId !== terminalId) continue
    if (evento.secuencia <= ultimaSecuenciaAcusada) continue
    if (vistos.has(evento.id)) continue

    vistos.add(evento.id)
    cola.push(evento)
  }

  return cola.sort((uno, otro) => uno.secuencia - otro.secuencia)
}

/**
 * La cola real: el store ya sabe leer "lo posterior al acuse" (`leerDesde`), y la función pura le
 * da la última palabra sobre orden y duplicados. Se recalcula en cada llamada, así una venta escrita
 * mientras tanto entra sin que nadie refresque nada.
 */
export async function pendientesDe(
  store: PosStore,
  terminalId: string,
  ultimaSecuenciaAcusada: number,
): Promise<Evento[]> {
  validarSecuenciaAcusada(ultimaSecuenciaAcusada)

  return colaDeSync(
    await store.leerDesde(terminalId, ultimaSecuenciaAcusada),
    terminalId,
    ultimaSecuenciaAcusada,
  )
}
