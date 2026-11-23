/**
 * Lo que el sync guarda fuera del libro: el **acuse** por terminal, y la purga del tenant al cerrar
 * sesión (docs/specs/0001-arquitectura.md §6, `0003` §Sync).
 *
 * Dos decisiones:
 *
 *   - **Una base por tenant.** El libro ya se llama `altoke-<tenantId>` (`App.tsx`), así que el
 *     acuse no puede vivir en una base compartida: al cerrar sesión se purga lo del tenant que
 *     cierra y **nada** del otro (`0001` §6). El acuse va en `altoke-sync-<tenantId>`, aparte
 *     porque la versión del almacén de eventos es del `PosStore` y este módulo no puede subirla.
 *   - **Purgar es vaciar las bases del tenant, no borrar el archivo.** Una terminal tiene el store
 *     abierto mientras la app corre; `deleteDatabase` se bloquea contra esa conexión y la promesa
 *     no termina. Vaciar todos los almacenes deja la base sin datos del tenant, que es lo que pide
 *     el invariante. **Una base que sigue existiendo no significa que el tenant existe**: el
 *     archivo queda vacío y ningún lector puede deducir de su presencia que hay datos; lo que se
 *     lee de él es el libro (vacío) y el acuse (0), que es el estado de una terminal sin sesión.
 */

/** El libro del tenant: mismo nombre que usa `App.tsx` para la base de IndexedDB. */
export const PREFIJO_BASE_DEL_TENANT = 'altoke-'
/** El acuse del tenant: base aparte para no pelear por la versión del almacén de eventos. */
export const PREFIJO_BASE_DE_ACUSES = 'altoke-sync-'
export const ALMACEN_DE_ACUSES = 'acuses'
const VERSION_ACUSES = 1

export function nombreDeBaseDelTenant(tenantId: string): string {
  return `${PREFIJO_BASE_DEL_TENANT}${tenantId}`
}

export function nombreDeBaseDeAcuses(tenantId: string): string {
  return `${PREFIJO_BASE_DE_ACUSES}${tenantId}`
}

/** Todas las bases que pertenecen a un tenant: la purga las recorre todas. */
export function basesDelTenant(tenantId: string): readonly string[] {
  return [nombreDeBaseDelTenant(tenantId), nombreDeBaseDeAcuses(tenantId)]
}

export interface AlmacenDeAcuses {
  /** Última secuencia acusada por el servidor para esa terminal; `0` si nunca hubo acuse. */
  leer(terminalId: string): Promise<number>
  guardar(terminalId: string, ultimaSecuencia: number): Promise<void>
}

export interface OpcionesAlmacenDeAcuses {
  readonly indexedDB: IDBFactory
  readonly tenantId: string
}

type RegistroDeAcuse = {
  readonly terminalId: string
  readonly ultimaSecuencia: number
}

/** Una secuencia acusada sirve como valor guardado si se puede volver a mandar como acuse. */
function esAcuseValido(valor: unknown): valor is number {
  return (
    typeof valor === 'number' &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor < Number.MAX_SAFE_INTEGER
  )
}

export function crearAlmacenDeAcuses(opciones: OpcionesAlmacenDeAcuses): AlmacenDeAcuses {
  const nombreDb = nombreDeBaseDeAcuses(opciones.tenantId)
  let apertura: Promise<IDBDatabase> | null = null

  const abrir = (): Promise<IDBDatabase> => {
    apertura ??= abrirBaseDeAcuses(opciones.indexedDB, nombreDb).catch((error: unknown) => {
      // Una apertura fallida no se cachea: un bundle viejo contra una base nueva tiene que poder
      // reintentar, no quedar muerto hasta cerrar la pestaña (misma regla que el `PosStore`).
      apertura = null
      throw error
    })
    return apertura
  }

  return {
    async leer(terminalId: string): Promise<number> {
      const db = await abrir()
      const transaccion = db.transaction(ALMACEN_DE_ACUSES, 'readonly')
      const registro = await pedir<RegistroDeAcuse | undefined>(
        transaccion.objectStore(ALMACEN_DE_ACUSES).get(terminalId),
      )

      // Un registro corrupto —de una versión vieja o de una pestaña rota— vale como "sin acuse":
      // reenviar lo ya acusado es un no-op; saltearlo perdería ventas.
      return esAcuseValido(registro?.ultimaSecuencia) ? registro.ultimaSecuencia : 0
    },

    async guardar(terminalId: string, ultimaSecuencia: number): Promise<void> {
      if (!esAcuseValido(ultimaSecuencia)) {
        throw new RangeError(`Secuencia acusada inválida: ${ultimaSecuencia}`)
      }

      const db = await abrir()
      const transaccion = db.transaction(ALMACEN_DE_ACUSES, 'readwrite')
      transaccion.objectStore(ALMACEN_DE_ACUSES).put({ terminalId, ultimaSecuencia } as RegistroDeAcuse)
      await esperarTransaccion(transaccion)
    },
  }
}

export interface OpcionesPurga {
  readonly indexedDB: IDBFactory
  readonly tenantId: string
}

/**
 * Purga las bases del tenant. Nunca toca las de otro tenant, y nunca lanza: cerrar sesión no puede
 * quedar bloqueado por un storage roto. Cada base se vacía por separado, así una que falle no deja
 * la otra con datos; llamarla de nuevo es seguro (vaciar es idempotente).
 */
export async function purgarTenantLocal(opciones: OpcionesPurga): Promise<void> {
  for (const nombreDb of basesDelTenant(opciones.tenantId)) {
    try {
      await vaciarBase(opciones.indexedDB, nombreDb)
    } catch {
      // Sin IndexedDB (modo privado, cuota, bloqueo) la sesión igual se cierra. La purga se
      // reintenta en el próximo cierre de sesión de ese tenant.
    }
  }
}

function abrirBaseDeAcuses(indexedDB: IDBFactory, nombreDb: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolver, rechazar) => {
    const solicitud = indexedDB.open(nombreDb, VERSION_ACUSES)

    solicitud.onupgradeneeded = () => {
      const db = solicitud.result
      if (db.objectStoreNames.contains(ALMACEN_DE_ACUSES)) return
      db.createObjectStore(ALMACEN_DE_ACUSES, { keyPath: 'terminalId' })
    }

    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error ?? new Error('No se pudo abrir IndexedDB'))
    solicitud.onblocked = () =>
      rechazar(new Error('IndexedDB bloqueada por otra pestaña con otra versión del POS'))
  })
}

/**
 * Abre sin versión: si la base no existe se crea vacía y no hay nada que vaciar. Pedir una versión
 * fija fallaría contra una base más nueva que la de este bundle.
 */
function abrirParaPurgar(indexedDB: IDBFactory, nombreDb: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolver, rechazar) => {
    const solicitud = indexedDB.open(nombreDb)

    solicitud.onsuccess = () => resolver(solicitud.result)
    solicitud.onerror = () => rechazar(solicitud.error ?? new Error('No se pudo abrir IndexedDB'))
    solicitud.onblocked = () =>
      rechazar(new Error('IndexedDB bloqueada por otra pestaña con otra versión del POS'))
  })
}

async function vaciarBase(indexedDB: IDBFactory, nombreDb: string): Promise<void> {
  const db = await abrirParaPurgar(indexedDB, nombreDb)

  try {
    const almacenes = Array.from(db.objectStoreNames)
    if (almacenes.length === 0) return

    const transaccion = db.transaction(almacenes, 'readwrite')
    for (const nombre of almacenes) transaccion.objectStore(nombre).clear()
    await esperarTransaccion(transaccion)
  } finally {
    db.close()
  }
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
