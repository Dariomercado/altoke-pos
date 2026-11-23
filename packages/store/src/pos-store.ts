/**
 * Puerto `PosStore` (docs/specs/0001-arquitectura.md §4): la persistencia local del libro de
 * eventos, detrás de una interfaz. Adaptadores: IndexedDB en la web, SQLite en Android, memoria
 * en tests.
 *
 * Las reglas del contrato —las que `contrato.ts` verifica igual para todo adaptador— no son
 * detalles de implementación, son la razón por la que existe el puerto:
 *
 *   1. **Se valida antes de escribir.** Un evento inválido hace fallar el lote entero y el libro
 *      queda intacto. Escribir medio lote deja el turno incoherente y sin forma de saber dónde.
 *   2. **Es idempotente por `id`.** La cola de sync reenvía lo que no recibió acuse; guardar dos
 *      veces el mismo evento duplicaría ventas y plata.
 *   3. **El orden de lectura es determinista:** `ocurridoEn`, después `secuencia`, después
 *      `terminalId`. Dos adaptadores que ordenan distinto producen dos totales distintos sobre el
 *      mismo libro, y el bug aparece sólo en el dispositivo del cliente. La fecha se compara como
 *      texto ISO, así que quien escribe tiene que normalizarla (UTC `Z`, misma precisión): dos
 *      formatos distintos del mismo instante rompen el orden sin avisar.
 *   4. **`leerDesde` es la cola de sync:** eventos de esa terminal con secuencia mayor al último
 *      acuse, en orden.
 *
 * La validación es de **escritura**. Lo que se lee se devuelve tal como está guardado: un registro
 * con `schemaVersion` desconocida (una pestaña vieja después de una actualización) es un problema
 * de migración y se resuelve en el borde de lectura, no acá. Detectar y migrar versiones entra con
 * el sync en M2.
 */

import { leerDesde as leerDesdeLibro, proyectar as proyectarLibro, validarEvento } from '@altoke/domain'
import type { Evento, Proyeccion } from '@altoke/domain'

export interface PosStore {
  /** Valida y agrega el lote de forma atómica. Idempotente por `id`. */
  append(eventos: readonly Evento[]): Promise<void>
  /** Eventos de una terminal con secuencia mayor a la acusada, en orden. */
  leerDesde(terminalId: string, secuencia: number): Promise<Evento[]>
  /** Proyecta el libro completo con la proyección recibida. */
  proyectar<T>(proyeccion: Proyeccion<T>): Promise<T>
  /** Vacía el libro. Sólo para tests y para el "reiniciar demo" del alta. */
  limpiar(): Promise<void>
}

/** Valida el lote entero antes de tocar el almacenamiento. */
export function validarLote(eventos: readonly Evento[]): void {
  for (const evento of eventos) validarEvento(evento)
}

/**
 * Copia profunda del lote con `structuredClone`, que es exactamente lo que IndexedDB guarda.
 *
 * Dos razones: el adaptador en memoria no puede ser más permisivo que el real (guardar la
 * referencia del llamador haría pasar en tests una mutación que en el navegador corrompe el libro),
 * y un evento no clonable —una función colada en un campo extra— se rechaza **antes** de abrir la
 * transacción, así no queda medio lote escrito.
 */
export function clonarLote(eventos: readonly Evento[]): Evento[] {
  return eventos.map((evento) => structuredClone(evento))
}

/** La secuencia acusada por el sync tiene que ser representable como clave de IndexedDB. */
export function validarAcuse(secuencia: number): void {
  if (!Number.isInteger(secuencia) || secuencia < 0 || secuencia >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`Secuencia acusada inválida: ${secuencia}`)
  }
}

/** Orden determinista del libro: fecha, secuencia, terminal. */
export function ordenarLibro(eventos: readonly Evento[]): Evento[] {
  return [...eventos].sort(
    (a, b) =>
      a.ocurridoEn.localeCompare(b.ocurridoEn) ||
      a.secuencia - b.secuencia ||
      a.terminalId.localeCompare(b.terminalId),
  )
}

export function leerDeLibro(
  eventos: readonly Evento[],
  terminalId: string,
  secuencia: number,
): Evento[] {
  return leerDesdeLibro(ordenarLibro(eventos), terminalId, secuencia)
}

export function proyectarLibroOrdenado<T>(
  eventos: readonly Evento[],
  proyeccion: Proyeccion<T>,
): T {
  return proyectarLibro(ordenarLibro(eventos), proyeccion)
}
