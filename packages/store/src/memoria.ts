/**
 * Adaptador en memoria del puerto `PosStore`.
 *
 * Existe **para tests**, no para uso: el POS real persiste en IndexedDB (T6, corrección posterior
 * a L6). Se usa para correr la suite de contrato rápido y para probar la UI sin base de datos.
 */

import type { Evento, Proyeccion } from '@altoke/domain'
import { clonarLote, leerDeLibro, proyectarLibroOrdenado, validarAcuse, validarLote } from './pos-store'
import type { PosStore } from './pos-store'

export function crearStoreEnMemoria(): PosStore {
  const porId = new Map<string, Evento>()

  return {
    async append(eventos: readonly Evento[]): Promise<void> {
      validarLote(eventos)

      // Copia, igual que IndexedDB: mutar el evento después de guardarlo no toca el libro.
      for (const evento of clonarLote(eventos)) {
        porId.set(evento.id, evento)
      }
    },

    async leerDesde(terminalId: string, secuencia: number): Promise<Evento[]> {
      validarAcuse(secuencia)

      return leerDeLibro([...porId.values()], terminalId, secuencia)
    },

    async proyectar<T>(proyeccion: Proyeccion<T>): Promise<T> {
      return proyectarLibroOrdenado([...porId.values()], proyeccion)
    },

    async limpiar(): Promise<void> {
      porId.clear()
    },
  }
}
