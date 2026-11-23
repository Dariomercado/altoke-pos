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
  CONTENEDORES_DEL_TEMA_CLARO,
  CONTRASTE_MINIMO,
  HUECOS_DE_MARCA,
  MARCA_POR_DEFECTO,
  contraste,
  esContrasteLegible,
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
 *
 * El loader hace cumplir el mismo contrato que el panel (`diagnosticoDeMarca`): un logo con esquema
 * no permitido o en blanco se descarta, y un par fondo/tinta que no se lea —o una marca oscura que
 * deje ilegibles los contenedores del tema claro— vuelve a los valores legibles de `MARCA_INICIAL`.
 * Así una entrada editada a mano en `localStorage` no puede pintar un POS ilegible.
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

/**
 * Logo del tenant normalizado. `undefined` es "sin logo".
 *
 * Un valor en blanco, o con un esquema que el navegador ejecutaría (`javascript:`, `//evil`,
 * `file:`), no se publica ni como `src=""` ni como URL ejecutable: el encabezado y el ticket no
 * dibujan `<img>` y el hueco `--brand-logo` se borra.
 */
export function logoDeMarca(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined

  const limpio = valor.trim()
  return esLogoValido(limpio) ? limpio : undefined
}

/** Ratio WCAG con coma decimal: `4,50:1` es como se lee en español. */
function formatearRatio(ratio: number): string {
  return `${ratio.toFixed(2).replace('.', ',')}:1`
}

/**
 * Por qué la marca no se puede aplicar, o `null` si se lee.
 *
 * La tinta del tenant tiene que leerse sobre su fondo **y** sobre los contenedores del tema claro
 * (`CONTENEDORES_DEL_TEMA_CLARO`), porque esos contenedores salen de `tokens.css` y todavía no
 * derivan de `--brand-surface`: una marca oscura se lee en el fondo del local y desaparece en las
 * tarjetas, así que se rechaza con el motivo escrito en vez de aplicarse rota.
 *
 * Es una función pura y es el único guard del proyecto: el panel la usa para avisar y el loader
 * para no arrancar con una marca ilegible de `localStorage`.
 */
export function diagnosticoDeMarca(marca: MarcaTenant): string | null {
  const fondo = normalizarColorDeMarca(marca.surface) ?? SUPERFICIE_INICIAL
  const texto = normalizarColorDeMarca(marca.text) ?? TINTA_INICIAL
  const fallos: string[] = []

  if (!esContrasteLegible(texto, fondo)) {
    fallos.push(`sobre el fondo ${fondo} (${formatearRatio(contraste(texto, fondo))})`)
  }

  const peorContenedor = CONTENEDORES_DEL_TEMA_CLARO.map((color) => ({
    color,
    ratio: contraste(texto, color),
  }))
    .filter(({ ratio }) => ratio < CONTRASTE_MINIMO)
    .sort((uno, otro) => uno.ratio - otro.ratio)[0]

  if (peorContenedor !== undefined) {
    fallos.push(
      `sobre los contenedores del tema claro, que no derivan de --brand-surface ` +
        `(el peor, ${peorContenedor.color}: ${formatearRatio(peorContenedor.ratio)})`,
    )
  }

  if (fallos.length === 0) return null

  return (
    `el texto ${texto} no es legible ${fallos.join(' ni ')}; ` +
    `el mínimo es ${formatearRatio(CONTRASTE_MINIMO)}`
  )
}

/** ¿La marca se lee en el POS? Misma regla que avisa el panel, sin el texto del aviso. */
export function marcaEsLegible(marca: MarcaTenant): boolean {
  return diagnosticoDeMarca(marca) === null
}

/**
 * Marca sin los campos que no están: un hueco ausente se borra en `aplicarMarca`. Se arma campo por
 * campo para no publicar `undefined` ni `''` en un hueco de marca.
 */
function armarMarca(campos: {
  readonly primary: string
  readonly accent: string
  readonly surface?: string | undefined
  readonly text?: string | undefined
  readonly logoUrl?: string | undefined
}): MarcaTenant {
  return {
    primary: campos.primary,
    accent: campos.accent,
    ...(campos.surface === undefined ? {} : { surface: campos.surface }),
    ...(campos.text === undefined ? {} : { text: campos.text }),
    ...(campos.logoUrl === undefined ? {} : { logoUrl: campos.logoUrl }),
  }
}

/** La marca sin logo: el hueco se omite para que `aplicarMarca` borre `--brand-logo`. */
export function sinLogo(marca: MarcaTenant): MarcaTenant {
  return armarMarca({
    primary: marca.primary,
    accent: marca.accent,
    surface: marca.surface,
    text: marca.text,
  })
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
  const logoUrl = logoDeMarca(campos['logoUrl'])

  // Fondo y tinta entran juntos o no entran: si el par guardado no se lee —o si una marca oscura
  // deja ilegibles los contenedores del tema claro— se cargan los valores legibles de
  // `MARCA_INICIAL`, que es la marca que el panel restablece.
  const guardada = marcaEsLegible({ primary, accent, surface, text })
    ? { primary, accent, surface, text }
    : { primary, accent, surface: SUPERFICIE_INICIAL, text: TINTA_INICIAL }

  return armarMarca({ ...guardada, logoUrl })
}
