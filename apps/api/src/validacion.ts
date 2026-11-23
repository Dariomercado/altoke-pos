/**
 * Validación de entrada a mano: sin schema de Fastify, para que cada mensaje y cada `campo` sean
 * los del contrato y no los que inventa un compilador de schemas.
 *
 * Todo lo inválido es `validacion` con `detalle.campo`, nunca un 500 ni un TypeError.
 */

import {
  LARGO_MAXIMO_PASSWORD,
  LARGO_MINIMO_PASSWORD,
  MENSAJE_PASSWORD_INVALIDA,
} from './password.ts'
import { validacion } from './errores.ts'

export type Cuerpo = Record<string, unknown>

export function leerCuerpo(cuerpo: unknown): Cuerpo {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
    throw validacion('El cuerpo del pedido tiene que ser un objeto JSON.')
  }
  return cuerpo as Cuerpo
}

export function leerObjeto(valor: unknown, campo: string): Cuerpo {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw validacion('El cuerpo del pedido tiene que ser un objeto JSON.', campo)
  }
  return valor as Cuerpo
}

export const MENSAJE_NOMBRE_INVALIDO = 'El nombre es obligatorio (máximo 120 caracteres).'

export function leerNombre(valor: unknown, campo: string): string {
  if (typeof valor !== 'string') throw validacion(MENSAJE_NOMBRE_INVALIDO, campo)
  const limpio = valor.trim()
  if (limpio.length === 0 || limpio.length > 120) throw validacion(MENSAJE_NOMBRE_INVALIDO, campo)
  return limpio
}

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MENSAJE_EMAIL_INVALIDO = 'El email no es válido.'

/** El email se guarda y se busca en minúsculas: `Juan@Kiosco.com` y `juan@kiosco.com` son la misma cuenta. */
export function leerEmail(valor: unknown): string {
  if (typeof valor !== 'string') throw validacion(MENSAJE_EMAIL_INVALIDO, 'email')
  const email = valor.trim().toLowerCase()
  if (email.length > 254 || !PATRON_EMAIL.test(email)) {
    throw validacion(MENSAJE_EMAIL_INVALIDO, 'email')
  }
  return email
}

/** Sin `trim`: un espacio es parte de la contraseña, igual que en cualquier otro login. */
export function leerPassword(valor: unknown): string {
  if (typeof valor !== 'string') throw validacion(MENSAJE_PASSWORD_INVALIDA, 'password')
  if (valor.length < LARGO_MINIMO_PASSWORD || valor.length > LARGO_MAXIMO_PASSWORD) {
    throw validacion(MENSAJE_PASSWORD_INVALIDA, 'password')
  }
  return valor
}

export const MENSAJE_SLUG_INVALIDO =
  'El slug tiene que tener entre 2 y 40 caracteres: minúsculas, números y guiones.'

export const LARGO_MINIMO_SLUG = 2
export const LARGO_MAXIMO_SLUG = 40

/** Forma: minúsculas, números y guiones interiores. Sin guion al principio ni al final. */
const PATRON_SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/

export function leerSlug(valor: unknown): string {
  if (typeof valor !== 'string') throw validacion(MENSAJE_SLUG_INVALIDO, 'tenant.slug')
  const slug = valor.trim().toLowerCase()
  // El largo se comprueba aparte del patrón: el mensaje promete 2–40 y tiene que cumplirlo.
  if (
    slug.length < LARGO_MINIMO_SLUG ||
    slug.length > LARGO_MAXIMO_SLUG ||
    !PATRON_SLUG.test(slug)
  ) {
    throw validacion(MENSAJE_SLUG_INVALIDO, 'tenant.slug')
  }
  return slug
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un id de ruta con forma inválida no puede llegar a Postgres: `WHERE id = $1` contra una columna
 * `uuid` revienta con 22P02 y eso sería un 500 por input del cliente.
 */
export function leerUuid(valor: string | undefined, campo: string, mensaje: string): string {
  if (valor === undefined || !PATRON_UUID.test(valor)) throw validacion(mensaje, campo)
  return valor.toLowerCase()
}
