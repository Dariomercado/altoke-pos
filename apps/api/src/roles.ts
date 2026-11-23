/**
 * Roles de 0001 §6, por tenant y nunca globales: `owner`, `admin`, `cajero`, `solo_lectura`.
 *
 * Este archivo es sólo el retículo de permisos (sin Fastify, sin base): el orden decide qué
 * alcanza a qué. `solo_lectura` no escribe, `cajero` cobra pero no administra el tenant, `admin`
 * y `owner` administran.
 */

/** De menos a más permiso. El índice es el rango. */
export const ROLES = ['solo_lectura', 'cajero', 'admin', 'owner'] as const

export type Rol = (typeof ROLES)[number]

export const RANGO_ROL: Readonly<Record<Rol, number>> = {
  solo_lectura: 0,
  cajero: 1,
  admin: 2,
  owner: 3,
}

export function esRol(valor: unknown): valor is Rol {
  return typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
}

/** `cajero` alcanza `solo_lectura`, no al revés. */
export function rolAlcanza(rol: Rol, minimo: Rol): boolean {
  return RANGO_ROL[rol] >= RANGO_ROL[minimo]
}

/**
 * Estrictamente por encima: `admin` supera a `cajero`, pero no a otro `admin` ni a un `owner`.
 * Es la comparación del reset de contraseña: nadie toca la credencial de un rol igual o mayor.
 */
export function rolSupera(rol: Rol, otro: Rol): boolean {
  return RANGO_ROL[rol] > RANGO_ROL[otro]
}
