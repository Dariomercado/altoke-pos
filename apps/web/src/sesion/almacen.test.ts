// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it } from 'vitest'
import { ALMACEN_DE_SESION, CLAVE_SESION, crearAlmacenDeSesion } from './almacen.ts'
import { SESION_DE_PRUEBA } from './dobles.ts'

afterEach(() => {
  localStorage.clear()
})

describe('almacén de sesión', () => {
  it('guarda el token en IndexedDB y no en localStorage', async () => {
    const indexedDB = new IDBFactory()
    const almacen = crearAlmacenDeSesion({ indexedDB })

    await almacen.guardar(SESION_DE_PRUEBA)

    // El token no puede quedar expuesto al `document` entero (`0003` §Auth).
    expect(localStorage.length).toBe(0)

    const reabierto = crearAlmacenDeSesion({ indexedDB })
    await expect(reabierto.leer()).resolves.toEqual(SESION_DE_PRUEBA)
  })

  it('borrar deja la terminal sin sesión y se puede volver a guardar', async () => {
    const almacen = crearAlmacenDeSesion({ indexedDB: new IDBFactory() })

    await almacen.guardar(SESION_DE_PRUEBA)
    await almacen.borrar()
    await expect(almacen.leer()).resolves.toBeNull()

    await almacen.guardar(SESION_DE_PRUEBA)
    await expect(almacen.leer()).resolves.toEqual(SESION_DE_PRUEBA)
  })

  it('un registro corrupto vale como sin sesión, no como una sesión a medias', async () => {
    const indexedDB = new IDBFactory()
    const almacen = crearAlmacenDeSesion({ indexedDB })
    await almacen.guardar(SESION_DE_PRUEBA)

    const db = await new Promise<IDBDatabase>((resolver, rechazar) => {
      const solicitud = indexedDB.open('altoke-sesion', 1)
      solicitud.onsuccess = () => resolver(solicitud.result)
      solicitud.onerror = () => rechazar(solicitud.error ?? new Error('no abrió'))
    })

    try {
      const transaccion = db.transaction(ALMACEN_DE_SESION, 'readwrite')
      transaccion.objectStore(ALMACEN_DE_SESION).put(
        { clave: CLAVE_SESION, token: '', usuario: null, tenant: null, rol: 'dios' },
      )
      await new Promise<void>((resolver, rechazar) => {
        transaccion.oncomplete = () => resolver()
        transaccion.onerror = () => rechazar(transaccion.error ?? new Error('no escribió'))
      })
    } finally {
      db.close()
    }

    await expect(crearAlmacenDeSesion({ indexedDB }).leer()).resolves.toBeNull()
  })
})
