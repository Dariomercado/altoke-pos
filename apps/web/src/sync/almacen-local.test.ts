/**
 * El acuse persistido y la purga del tenant (docs/specs/0001-arquitectura.md §6, `0003` §Sync).
 *
 * Lo que se prueba:
 *   - el acuse sobrevive a recargar la pestaña (otra instancia, misma IndexedDB),
 *   - es por terminal y arranca en cero,
 *   - cerrar sesión purga el libro y el acuse del tenant que cierra,
 *   - y no toca un solo evento ni un solo acuse de otro tenant.
 */

import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { crearIndexedDbStore } from '@altoke/store'
import {
  crearAlmacenDeAcuses,
  nombreDeBaseDeAcuses,
  nombreDeBaseDelTenant,
  purgarTenantLocal,
} from './almacen-local.ts'
import { TERMINAL_DE_PRUEBA, eventoDePrueba } from './dobles.ts'

const TENANT_A = 'kiosco-a'
const TENANT_B = 'kiosco-b'

describe('almacén de acuses', () => {
  it('sin acuse guardado la terminal arranca en cero', async () => {
    const acuses = crearAlmacenDeAcuses({ indexedDB: new IDBFactory(), tenantId: TENANT_A })

    await expect(acuses.leer(TERMINAL_DE_PRUEBA)).resolves.toBe(0)
  })

  it('el acuse sobrevive a recargar la pestaña y es por terminal', async () => {
    const indexedDB = new IDBFactory()
    const antes = crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_A })
    await antes.guardar(TERMINAL_DE_PRUEBA, 7)

    const despues = crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_A })
    await expect(despues.leer(TERMINAL_DE_PRUEBA)).resolves.toBe(7)
    await expect(despues.leer('otra-terminal')).resolves.toBe(0)
  })

  it('los acuses de dos tenants no comparten base', async () => {
    const indexedDB = new IDBFactory()
    await crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_A }).guardar(TERMINAL_DE_PRUEBA, 3)

    await expect(
      crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_B }).leer(TERMINAL_DE_PRUEBA),
    ).resolves.toBe(0)
  })

  it('un acuse guardado corrupto se lee como cero en vez de mandar de más', async () => {
    const indexedDB = new IDBFactory()
    const tenantId = TENANT_A

    // Se escribe a mano lo que una versión vieja o una pestaña rota pudo dejar.
    await new Promise<void>((resolver, rechazar) => {
      const solicitud = indexedDB.open(nombreDeBaseDeAcuses(tenantId), 1)
      solicitud.onupgradeneeded = () => {
        solicitud.result.createObjectStore('acuses', { keyPath: 'terminalId' })
      }
      solicitud.onsuccess = () => {
        const db = solicitud.result
        const transaccion = db.transaction('acuses', 'readwrite')
        transaccion.objectStore('acuses').put({ terminalId: TERMINAL_DE_PRUEBA, ultimaSecuencia: -4 })
        transaccion.oncomplete = () => {
          db.close()
          resolver()
        }
        transaccion.onerror = () => rechazar(transaccion.error)
      }
      solicitud.onerror = () => rechazar(solicitud.error)
    })

    await expect(
      crearAlmacenDeAcuses({ indexedDB, tenantId }).leer(TERMINAL_DE_PRUEBA),
    ).resolves.toBe(0)
  })
})

describe('purgarTenantLocal', () => {
  it('purga el libro y el acuse del tenant que cierra sesión', async () => {
    const indexedDB = new IDBFactory()
    const libro = crearIndexedDbStore({
      indexedDB,
      nombreDb: nombreDeBaseDelTenant(TENANT_A),
    })
    await libro.append([eventoDePrueba(1), eventoDePrueba(2)])
    await crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_A }).guardar(TERMINAL_DE_PRUEBA, 2)

    await purgarTenantLocal({ indexedDB, tenantId: TENANT_A })

    await expect(libro.proyectar({ inicial: 0, aplicar: (total) => total + 1 })).resolves.toBe(0)
    await expect(
      crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_A }).leer(TERMINAL_DE_PRUEBA),
    ).resolves.toBe(0)
  })

  it('deja intacto el libro y el acuse de otro tenant', async () => {
    const indexedDB = new IDBFactory()
    const libroA = crearIndexedDbStore({ indexedDB, nombreDb: nombreDeBaseDelTenant(TENANT_A) })
    const libroB = crearIndexedDbStore({ indexedDB, nombreDb: nombreDeBaseDelTenant(TENANT_B) })
    await libroA.append([eventoDePrueba(1)])
    await libroB.append([eventoDePrueba(1), eventoDePrueba(2)])
    await crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_B }).guardar(TERMINAL_DE_PRUEBA, 2)

    await purgarTenantLocal({ indexedDB, tenantId: TENANT_A })

    await expect(libroB.proyectar({ inicial: 0, aplicar: (total) => total + 1 })).resolves.toBe(2)
    await expect(
      crearAlmacenDeAcuses({ indexedDB, tenantId: TENANT_B }).leer(TERMINAL_DE_PRUEBA),
    ).resolves.toBe(2)
  })

  it('purgar un tenant que nunca sincronizó no falla', async () => {
    await expect(
      purgarTenantLocal({ indexedDB: new IDBFactory(), tenantId: 'kiosco-sin-base' }),
    ).resolves.toBeUndefined()
  })
})
