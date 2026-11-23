// Instala IndexedDB en Node (`IDBKeyRange` incluido): el adaptador usa los globales del
// navegador, igual que en la app, y los tests le inyectan una fábrica limpia por caso.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { proyeccionStock } from '@altoke/domain'
import type { Evento } from '@altoke/domain'
import { crearIndexedDbStore } from './indexeddb'
import { probarContratoPosStore } from './contrato'

let prueba = 0

probarContratoPosStore(async () =>
  crearIndexedDbStore({ indexedDB: new IDBFactory(), nombreDb: `altoke-contrato-${++prueba}` }),
)

const EVENTO: Evento = {
  id: 'evt-persistente-1',
  tenantId: 'kiosco-1',
  terminalId: 'term-1',
  secuencia: 1,
  ocurridoEn: '2026-11-22T10:00:00.000Z',
  schemaVersion: 1,
  tipo: 'ajuste_stock',
  sku: 'alfajor',
  delta: 10,
  causa: 'inicial',
}

describe('IndexedDbStore — persistencia real', () => {
  it('el libro sobrevive a recargar la pestaña', async () => {
    const indexedDB = new IDBFactory()
    const nombreDb = 'altoke-persistente'

    const antes = crearIndexedDbStore({ indexedDB, nombreDb })
    await antes.append([EVENTO])

    // Otra instancia, como la que crea la app al recargar: misma base, mismo libro.
    const despues = crearIndexedDbStore({ indexedDB, nombreDb })

    await expect(despues.proyectar(proyeccionStock())).resolves.toEqual({ alfajor: 10 })
  })

  it('reintenta abrir después de un fallo en vez de quedar muerto', async () => {
    const indexedDB = new IDBFactory()
    const nombreDb = 'altoke-vieja'

    // Otra versión del POS dejó la base en v2: este bundle (v1) no puede abrirla.
    await new Promise<void>((resolver, rechazar) => {
      const solicitud = indexedDB.open(nombreDb, 2)
      solicitud.onsuccess = () => {
        solicitud.result.close()
        resolver()
      }
      solicitud.onerror = () => rechazar(solicitud.error)
    })

    const store = crearIndexedDbStore({ indexedDB, nombreDb })
    await expect(store.leerDesde('term-1', 0)).rejects.toThrow()

    // Alguien borra la base incompatible (reinstalar, "reiniciar demo"): el mismo store revive.
    await new Promise<void>((resolver, rechazar) => {
      const solicitud = indexedDB.deleteDatabase(nombreDb)
      solicitud.onsuccess = () => resolver()
      solicitud.onerror = () => rechazar(solicitud.error)
    })

    await expect(store.leerDesde('term-1', 0)).resolves.toEqual([])
  })

  it('dos bases distintas no comparten eventos', async () => {
    const indexedDB = new IDBFactory()

    const primera = crearIndexedDbStore({ indexedDB, nombreDb: 'altoke-a' })
    const segunda = crearIndexedDbStore({ indexedDB, nombreDb: 'altoke-b' })
    await primera.append([EVENTO])

    await expect(segunda.leerDesde('term-1', 0)).resolves.toEqual([])
  })
})
