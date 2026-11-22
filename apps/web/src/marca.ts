/**
 * La marca del tenant en la web (T8): cinco variables por tenant, guardadas en `localStorage` y
 * aplicadas en vivo sobre la raíz del documento.
 *
 * Vive en `apps/web` y no en `@altoke/ui` porque toca storage y DOM (invariante I1: el dominio no
 * conoce ninguno de los dos). El paquete de UI sólo sabe convertir una marca en custom properties,
 * y `aplicarMarca` se limita a escribirlas: no hay una sexta variable, ni un estilo por componente.
 *
 * Todo lo que puede fallar acá falla hacia adentro: un `localStorage` lleno o una entrada corrupta
 * no pueden impedir que el POS cobre.
 */

import {
  HUECOS_DE_MARCA,
  MARCA_POR_DEFECTO,
  normalizarColorDeMarca,
  variablesDeMarca,
} from '@altoke/ui'
import type { MarcaTenant } from '@altoke/ui'

/** La marca de arranque: el claro de `tokens.css`, que es lo que ve el primer tenant. */
export const SUPERFICIE_INICIAL = '#fbf8ff'
export const TINTA_INICIAL = '#1b1b21'

export const MARCA_INICIAL: MarcaTenant = {
  ...MARCA_POR_DEFECTO,
  surface: SUPERFICIE_INICIAL,
  text: TINTA_INICIAL,
}

export const PREFIJO_CLAVE = 'altoke:marca:'

/** Una clave por tenant: la marca de un kiosco no puede aparecer en otro (`0001` §6). */
export function claveDeMarca(tenantId: string): string {
  return `${PREFIJO_CLAVE}${tenantId}`
}

/**
 * Marca guardada del tenant. Nunca devuelve `undefined` ni lanza: una entrada rota —o escrita por
 * una versión vieja— cae campo por campo a `MARCA_INICIAL`.
 */
export function cargarMarca(tenantId: string): MarcaTenant {
  let crudo: string | null

  try {
    crudo = globalThis.localStorage?.getItem(claveDeMarca(tenantId)) ?? null
  } catch {
    return MARCA_INICIAL
  }

  return marcaDesdeTexto(crudo)
}

export function guardarMarca(tenantId: string, marca: MarcaTenant): void {
  try {
    globalThis.localStorage?.setItem(claveDeMarca(tenantId), JSON.stringify(marca))
  } catch {
    // Sin storage (modo privado, cuota llena) la marca igual se aplica: perder la preferencia no
    // puede romper la venta.
  }
}

/**
 * Aplica la marca sobre `root` (el documento por defecto).
 *
 * Un hueco sin valor válido se **borra** en vez de dejar el anterior: si el tenant saca su logo,
 * el logo se va. Los valores inválidos nunca llegan acá (`variablesDeMarca` los omite).
 */
export function aplicarMarca(marca: MarcaTenant, root: HTMLElement = document.documentElement): void {
  const variables = variablesDeMarca(marca)

  for (const [propiedad, valor] of Object.entries(variables)) {
    root.style.setProperty(propiedad, valor)
  }

  for (const hueco of HUECOS_DE_MARCA) {
    if (variables[hueco] === undefined) root.style.removeProperty(hueco)
  }
}

/** Un logo sólo se acepta si `variablesDeMarca` lo publica: http, https o data:image. */
export function esLogoValido(url: string): boolean {
  return variablesDeMarca({ logoUrl: url })['--brand-logo'] !== undefined
}

function marcaDesdeTexto(crudo: string | null): MarcaTenant {
  if (crudo === null) return MARCA_INICIAL

  let datos: unknown

  try {
    datos = JSON.parse(crudo)
  } catch {
    return MARCA_INICIAL
  }

  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return MARCA_INICIAL

  const campos = datos as Readonly<Record<string, unknown>>
  const primary = normalizarColorDeMarca(campos['primary']) ?? MARCA_INICIAL.primary
  const accent = normalizarColorDeMarca(campos['accent']) ?? MARCA_POR_DEFECTO.accent
  const surface = normalizarColorDeMarca(campos['surface']) ?? SUPERFICIE_INICIAL
  const text = normalizarColorDeMarca(campos['text']) ?? TINTA_INICIAL

  const logo = typeof campos['logoUrl'] === 'string' ? campos['logoUrl'].trim() : ''

  // El logo vacío es "sin logo": no se guarda la propiedad para no publicar una URL vacía.
  return logo === '' ? { primary, accent, surface, text } : { primary, accent, surface, text, logoUrl: logo }
}
