/**
 * El token de la sesión, en IndexedDB y no en `localStorage` (`0003` §Auth).
 *
 * `localStorage` queda expuesto al `document` entero y a cualquier script que corra en la página;
 * IndexedDB no es mágicamente seguro, pero el token no está a una línea de `document.cookie` de
 * distancia y sobrevive a recargar la pestaña. Se guarda **la sesión completa** —usuario, tenant y
 * rol— porque sin red el POS tiene que poder abrir con lo último que el servidor confirmó.
 */

import { esRol } from './permisos.ts'
import type { SesionActiva, Tenant, Usuario } from './tipos.ts'

/** Base propia: no comparte nombre con el libro (`altoke-<tenant>`) ni con los acuses. */
export const NOMBRE_BASE_DE_SESION = 'altoke-sesion'
export const ALMACEN_DE_SESION = 'sesion'
/** Una terminal tiene una sesión vigente; no una lista. */
export const CLAVE_SESION = 'vigente'
const VERSION = 1

export interface AlmacenDeSesion {
  leer(): Promise<SesionActiva | null>
  guardar(sesion: SesionActiva): Promise<void>
  borrar(): Promise<void>
}

export interface OpcionesAlmacenDeSesion {
  readonly indexedDB: IDBFactory
}

type RegistroDeSesion = { readonly clave: string } & SesionActiva

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== ''
}

function esUsuario(valor: unknown): valor is Usuario {
  return (
    esObjeto(valor) &&
    esTexto(valor['id']) &&
    esTexto(valor['email']) &&
    esTexto(valor['nombre'])
  )
}

function esTenant(valor: unknown): valor is Tenant {
  return (
    esObjeto(valor) &&
    esTexto(valor['id']) &&
    esTexto(valor['slug']) &&
    esTexto(valor['nombre'])
  )
}

/**
 * Un registro a medias —de un bundle viejo, de una pestaña que murió escribiendo— no es una
 * sesión: se lee como "sin sesión" y el login vuelve a pedir credenciales. Media credencial es
 * peor que ninguna.
 */
function esSesion(valor: unknown): valor is SesionActiva {
  return (
    esObjeto(valor) &&
    esTexto(valor['token']) &&
    esUsuario(valor['usuario']) &&
    esTenant(valor['tenant']) &&
    esRol(valor['rol'])
  )
}

export function crearAlmacenDeSesion(opciones: OpcionesAlmacenDeSesion): AlmacenDeSesion {
  let apertura: Promise<IDBDatabase> | null = null

  const abrir = (): Promise<IDBDatabase> => {
    apertura ??= abrirBase(opciones.indexedDB).catch((error: unknown) => {
      // Una apertura fallida no se cachea: modo privado o una base bloqueada por otra pestaña
      // tienen que poder reintentar en el próximo login.
      apertura = null
      throw error
    })
    return apertura
  }

  return {
    async leer(): Promise<SesionActiva | null> {
      const db = await abrir()
      const transaccion = db.transaction(ALMACEN_DE_SESION, 'readonly')
      const registro = await pedir<RegistroDeSesion | undefined>(
        transaccion.objectStore(ALMACEN_DE_SESION).get(CLAVE_SESION),
      )

      return esSesion(registro)
        ? {
            token: registro.token,
            usuario: registro.usuario,
            tenant: registro.tenant,
            rol: registro.rol,
          }
        : null
    },

    async guardar(sesion: SesionActiva): Promise<void> {
      const registro: RegistroDeSesion = { clave: CLAVE_SESION, ...sesion }
      const db = await abrir()
      const transaccion = db.transaction(ALMACEN_DE_SESION, 'readwrite')
      transaccion.objectStore(ALMACEN_DE_SESION).put(registro)
      await esperarTransaccion(transaccion)
    },

    async borrar(): Promise<void> {
      const db = await abrir()
      const transaccion = db.transaction(ALMACEN_DE_SESION, 'readwrite')
      transaccion.objectStore(ALMACEN_DE_SESION).delete(CLAVE_SESION)
      await esperarTransaccion(transaccion)
    },
  }
}

function abrirBase(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolver, rechazar) => {
    const solicitud = indexedDB.open(NOMBRE_BASE_DE_SESION, VERSION)

    solicitud.onupgradeneeded = () => {
      const db = solicitud.result
      if (db.objectStoreNames.contains(ALMACEN_DE_SESION)) return
      db.createObjectStore(ALMACEN_DE_SESION, { keyPath: 'clave' })
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
