/**
 * Lo que la app necesita para abrir una sesión, con los adaptadores reales por defecto.
 *
 * La app no construye IndexedDB, `fetch` ni la purga a mano: este archivo elige los adaptadores y
 * los tests los reemplazan. Así `App` no sabe si corre contra el navegador o contra dobles.
 */

import { purgarTenantLocal } from '../sync'
import { crearAlmacenDeSesion } from './almacen.ts'
import type { AlmacenDeSesion } from './almacen.ts'
import { baseUrlDesdeEntorno, crearClienteDeSesion } from './cliente.ts'
import type { ClienteDeSesion } from './cliente.ts'

export interface OpcionesSesionApp {
  readonly almacen?: AlmacenDeSesion | undefined
  readonly cliente?: ClienteDeSesion | undefined
  readonly purgar?: ((tenantId: string) => Promise<void>) | undefined
  readonly baseUrl?: string | undefined
  readonly fetch?: typeof fetch | undefined
}

export interface DependenciasDeSesion {
  readonly almacen: AlmacenDeSesion
  readonly cliente: ClienteDeSesion
  readonly purgar: (tenantId: string) => Promise<void>
}

export function crearDependenciasDeSesion(
  opciones: OpcionesSesionApp = {},
): DependenciasDeSesion {
  const indexedDB = globalThis.indexedDB

  return {
    almacen: opciones.almacen ?? crearAlmacenDeSesion({ indexedDB }),
    cliente:
      opciones.cliente ??
      crearClienteDeSesion({
        baseUrl: opciones.baseUrl ?? baseUrlDesdeEntorno(),
        fetch: opciones.fetch,
      }),
    purgar: opciones.purgar ?? ((tenantId) => purgarTenantLocal({ indexedDB, tenantId })),
  }
}
