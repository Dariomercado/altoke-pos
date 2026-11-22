/**
 * Adaptador IndexedDB del puerto `PosStore`: la persistencia real del POS web.
 *
 * Sin esto el POS pierde todo al recargar la pestaña, que es exactamente lo que hace inútil un
 * demo para pilotear (ver la corrección posterior a L6 en `odd/tasks/altoke-m1-pos.md`).
 *
 * Decisiones:
 *   - La fábrica de IndexedDB se **inyecta**: la app pasa `globalThis.indexedDB`, los tests pasan
 *     `fake-indexeddb`, y el adaptador no depende del entorno.
 *   - La clave es el `id` del evento, así el `put` es idempotente y el reenvío de sync no duplica.
 *   - El índice `por_terminal` sobre `['terminalId', 'secuencia']` es la cola de sync: la lectura
 *     pide exactamente el rango pendiente de una terminal y lo recibe ordenado.
 *   - Un lote inválido —o que no se puede clonar— se rechaza **antes** de abrir la transacción: no
 *     queda medio lote escrito.
 *   - Una apertura fallida no se cachea: una app que quedó con un bundle viejo contra una base más
 *     nueva tiene que poder reintentar, no quedar muerta hasta cerrar la pestaña.
 */

import type { Evento, Proyeccion } from '@altoke/domain'
import { clonarLote, proyectarLibroOrdenado, validarAcuse, validarLote } from './pos-store'
import type { PosStore } from './pos-store'

const ALMACEN_POR_DEFECTO = 'eventos'
const INDICE_POR_TERMINAL = 'por_terminal'
const VERSION_DB = 1

export interface OpcionesIndexedDb {
  readonly indexedDB: IDBFactory
  readonly nombreDb: string
  readonly nombreAlmacen?: string
}

export function crearIndexedDbStore(opciones: OpcionesIndexedDb): PosStore {
  const nombreAlmacen = opciones.nombreAlmacen ?? ALMACEN_POR_DEFECTO
  let apertura: Promise<IDBDatabase> | null = null

  const abrir = (): Promise<IDBDatabase> => {
    apertura ??= abrirBase(opciones.indexedDB, opciones.nombreDb, nombreAlmacen).catch(
      (error: unknown) => {
        apertura = null
        throw error
      },
    )
    return apertura
  }

  return {
    async append(eventos: readonly Evento[]): Promise<void> {
      validarLote(eventos)
      if (eventos.length === 0) return

      // Se clona antes de abrir la transacción: lo que no es clonable nunca llega a escribirse.
      const lote = clonarLote(eventos)

      const db = await abrir()
      const transaccion = db.transaction(nombreAlmacen, 'readwrite')
      const almacen = transaccion.objectStore(nombreAlmacen)

      for (const evento of lote) {
        almacen.put(evento)
      }

      await esperarTransaccion(transaccion)
    },

    async leerDesde(terminalId: string, secuencia: number): Promise<Evento[]> {
      validarAcuse(secuencia)

      const db = await abrir()
      const transaccion = db.transaction(nombreAlmacen, 'readonly')
      const indice = transaccion.objectStore(nombreAlmacen).index(INDICE_POR_TERMINAL)
      const rango = IDBKeyRange.bound(
        [terminalId, secuencia + 1],
        [terminalId, Number.MAX_SAFE_INTEGER],
      )

      return pedir(indice.getAll(rango))
    },

    async proyectar<T>(proyeccion: Proyeccion<T>): Promise<T> {
      const db = await abrir()
      const transaccion = db.transaction(nombreAlmacen, 'readonly')
      const eventos = await pedir<Evento[]>(
        transaccion.objectStore(nombreAlmacen).getAll() as IDBRequest<Evento[]>,
      )

      return proyectarLibroOrdenado(eventos, proyeccion)
    },

    async limpiar(): Promise<void> {
      const db = await abrir()
      const transaccion = db.transaction(nombreAlmacen, 'readwrite')

      transaccion.objectStore(nombreAlmacen).clear()

      await esperarTransaccion(transaccion)
    },
  }
}

function abrirBase(indexedDB: IDBFactory, nombreDb: string, nombreAlmacen: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolver, rechazar) => {
    const solicitud = indexedDB.open(nombreDb, VERSION_DB)

    solicitud.onupgradeneeded = () => {
      const db = solicitud.result
      if (db.objectStoreNames.contains(nombreAlmacen)) return

      const almacen = db.createObjectStore(nombreAlmacen, { keyPath: 'id' })
      almacen.createIndex(INDICE_POR_TERMINAL, ['terminalId', 'secuencia'], { unique: false })
    }

    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error ?? new Error('No se pudo abrir IndexedDB'))
    solicitud.onblocked = () =>
      rechazar(new Error('IndexedDB bloqueada por otra pestaña con otra versión del POS'))
  })
}

function pedir<T>(solicitud: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error ?? new Error('Error de IndexedDB'))
  })
}

function esperarTransaccion(transaccion: IDBTransaction): Promise<void> {
  return new Promise<void>((resolver, rechazar) => {
    transaccion.oncomplete = () => resolver()
    transaccion.onerror = () => rechazar(transaccion.error ?? new Error('Transacción fallida'))
    transaccion.onabort = () => rechazar(transaccion.error ?? new Error('Transacción abortada'))
  })
}
