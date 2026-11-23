/**
 * Roles y permisos del POS (docs/specs/0001-arquitectura.md §6, `0003` §Auth).
 *
 * Los cuatro roles son **por tenant y nunca globales**: la sesión activa trae el rol de la
 * membresía elegida. Este archivo es el retículo de permisos, sin React y sin IO, para que la
 * pantalla y las acciones del POS consulten la misma respuesta: esconder un botón es una pista,
 * no el permiso.
 */

export const ROLES = ['owner', 'admin', 'cajero', 'solo_lectura'] as const

export type Rol = (typeof ROLES)[number]

export const ACCIONES_DE_POS = ['cobrar', 'cerrar_caja', 'administrar_marca'] as const

export type AccionDePos = (typeof ACCIONES_DE_POS)[number]

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/**
 * `owner`, `admin` y `cajero` cobran y cierran; `solo_lectura` no. La marca es del tenant y sólo
 * la administran `admin` y `owner`: el cajero cobra y cierra, no cambia la cara del local.
 */
export function puede(rol: Rol, accion: AccionDePos): boolean {
  switch (accion) {
    case 'cobrar':
    case 'cerrar_caja':
      return rol !== 'solo_lectura'
    case 'administrar_marca':
      return rol === 'owner' || rol === 'admin'
  }
}
