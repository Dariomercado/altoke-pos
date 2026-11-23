/**
 * Las formas de la sesión de la terminal (docs/specs/0003-api-y-sync.md §Auth).
 *
 * `SesionActiva` es lo que el POS necesita para cobrar sin volver a preguntar: token, usuario,
 * tenant y rol. Se guarda entera en IndexedDB para que recargar la pestaña —o quedarse sin red—
 * no obligue a un login que dejaría el mostrador parado.
 */

import type { Rol } from './permisos.ts'

export interface Usuario {
  readonly id: string
  readonly email: string
  readonly nombre: string
}

export interface Tenant {
  readonly id: string
  readonly slug: string
  readonly nombre: string
}

/** Una membresía de `/auth/yo`: el tenant con el rol que ese usuario tiene en él. */
export interface Membresia {
  readonly tenantId: string
  readonly slug: string
  readonly nombre: string
  readonly rol: Rol
}

export interface SesionActiva {
  readonly token: string
  readonly usuario: Usuario
  readonly tenant: Tenant
  readonly rol: Rol
}

/** Lo que sobrevive en IndexedDB: la misma sesión, para reabrir la terminal sin red. */
export type SesionGuardada = SesionActiva

/** Respuesta de `POST /auth/registro` y `POST /auth/sesion`. */
export interface RespuestaSesion {
  readonly token: string
  readonly expiraEn: string
  readonly usuario: Usuario
  readonly tenant: Tenant
  readonly rol: Rol
}

/** Respuesta de `GET /auth/yo`. */
export interface RespuestaYo {
  readonly usuario: Usuario
  readonly membresias: readonly Membresia[]
}

/** Alta de tenant: el dueño crea el local y su propia cuenta en una sola operación. */
export interface DatosDeRegistro {
  readonly nombre: string
  readonly email: string
  readonly password: string
  readonly tenant: {
    readonly nombre: string
    readonly slug: string
  }
}
