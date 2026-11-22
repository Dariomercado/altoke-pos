export interface MarcaTenant {
  readonly primary: string
  readonly accent: string
  /** Fondo del local. Sólo se aplica si es un hex válido. */
  readonly surface?: string
  /** Tinta del local. Sólo se aplica si es un hex válido. */
  readonly text?: string
  readonly logoUrl?: string
}

export const MARCA_POR_DEFECTO: MarcaTenant = {
  primary: '#4d44e3',
  accent: '#005049',
}

/**
 * Los contenedores del tema claro (`tokens.css`) que **no** derivan de `--brand-surface`.
 *
 * Es la razón por la que una marca oscura se rechaza: el fondo y la tinta del tenant se aplican
 * sobre `--color-surface` y `--color-on-surface`, pero las tarjetas y los paneles siguen pintándose
 * con estos cuatro colores fijos, así que una tinta clara desaparece encima de ellos (1.05:1 sobre
 * blanco). Hasta que los contenedores se deriven de la marca, el guard valida contra todos.
 */
export const CONTENEDORES_DEL_TEMA_CLARO = [
  '#ffffff',
  '#f5f2fa',
  '#efecf4',
  '#e9e7ee',
  '#e4e1e9',
] as const

/**
 * Los cinco huecos que un tenant sobrescribe (`0001` §7). Es el contrato entre `tokens.css` y las
 * apps: el resto de la paleta se deriva de estos, así que la lista no se escribe de nuevo en la
 * app.
 */
export const HUECOS_DE_MARCA = [
  '--brand-primary',
  '--brand-accent',
  '--brand-surface',
  '--brand-text',
  '--brand-logo',
] as const

/** Texto oscuro sobre fondos claros, y blanco sobre fondos oscuros. */
const TEXTO_OSCURO = '#17142b'
const TEXTO_CLARO = '#ffffff'

/** Umbral de luminancia donde el contraste contra blanco iguala al de negro. */
const UMBRAL_LUMINANCIA = 0.179

const HEX_CORTO = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_LARGO = /^#[0-9a-f]{6}$/i
const LOGO_PERMITIDO = /^(https?:\/\/|data:image\/)/i

/** Mínimo de WCAG AA para texto normal: por debajo, la marca se rechaza. */
export const CONTRASTE_MINIMO = 4.5

/** Color hex normalizado (seis dígitos minúscula), o `undefined` si el valor no es un hex. */
export function normalizarColorDeMarca(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined

  const limpio = valor.trim()

  if (HEX_CORTO.test(limpio)) {
    const cuerpo = limpio.slice(1).toLowerCase()
    const r = cuerpo.charAt(0)
    const g = cuerpo.charAt(1)
    const b = cuerpo.charAt(2)
    return `#${r}${r}${g}${g}${b}${b}`
  }

  return HEX_LARGO.test(limpio) ? limpio.toLowerCase() : undefined
}

function normalizarColor(valor: unknown, porDefecto: string): string {
  return normalizarColorDeMarca(valor) ?? porDefecto
}

function normalizarLogo(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined

  const limpio = valor.trim()
  return LOGO_PERMITIDO.test(limpio) ? limpio : undefined
}

function canalLineal(octeto: string): number {
  const srgb = Number.parseInt(octeto, 16) / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

/** Luminancia relativa WCAG de un color. Un valor inválido cae al primario por defecto. */
function luminanciaRelativa(color: string): number {
  const hex = normalizarColor(color, MARCA_POR_DEFECTO.primary)

  return (
    0.2126 * canalLineal(hex.slice(1, 3)) +
    0.7152 * canalLineal(hex.slice(3, 5)) +
    0.0722 * canalLineal(hex.slice(5, 7))
  )
}

/**
 * Ratio de contraste WCAG entre dos colores: 1 (iguales) a 21 (negro sobre blanco).
 *
 * Es la única cuenta de contraste del proyecto: el guard de la marca, `textoSobre` y los tests de
 * `tokens.css` salen de acá.
 */
export function contraste(colorA: string, colorB: string): number {
  const a = luminanciaRelativa(colorA)
  const b = luminanciaRelativa(colorB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** ¿El par se lee? Mismo umbral AA (4.5:1) que usa `tokens.css`. */
export function esContrasteLegible(texto: string, fondo: string): boolean {
  return contraste(texto, fondo) >= CONTRASTE_MINIMO
}

/**
 * Texto legible sobre un color de marca arbitrario.
 *
 * Sin esto, un tenant que elige un naranja o un amarillo deja los botones con
 * texto blanco e ilegibles. Es la diferencia entre un demo que resiste cualquier
 * marca y uno que se rompe en la primera reunión.
 */
export function textoSobre(color: string): string {
  return luminanciaRelativa(color) > UMBRAL_LUMINANCIA ? TEXTO_OSCURO : TEXTO_CLARO
}

/** Variables CSS que un tenant puede sobrescribir. Todo lo demás es derivado. */
export function variablesDeMarca(marca: Partial<MarcaTenant> | undefined): Record<string, string> {
  const primary = normalizarColor(marca?.primary, MARCA_POR_DEFECTO.primary)
  const accent = normalizarColor(marca?.accent, MARCA_POR_DEFECTO.accent)

  const variables: Record<string, string> = {
    '--brand-primary': primary,
    '--brand-accent': accent,
    '--brand-on-primary': textoSobre(primary),
    '--brand-on-accent': textoSobre(accent),
  }

  // Fondo y tinta los elige el tenant: un valor inválido se omite (y `aplicarMarca` borra la
  // variable) para que el tema quede con lo de `tokens.css` en vez de aplicar basura.
  const surface = normalizarColorDeMarca(marca?.surface)
  const text = normalizarColorDeMarca(marca?.text)
  if (surface !== undefined) variables['--brand-surface'] = surface
  if (text !== undefined) variables['--brand-text'] = text

  const logo = normalizarLogo(marca?.logoUrl)
  if (logo !== undefined) variables['--brand-logo'] = logo

  return variables
}
