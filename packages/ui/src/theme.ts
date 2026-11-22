export interface MarcaTenant {
  readonly primary: string
  readonly accent: string
  readonly logoUrl?: string
}

export const MARCA_POR_DEFECTO: MarcaTenant = {
  primary: '#4f46e5',
  accent: '#0d9488',
}

/** Texto oscuro sobre fondos claros, y blanco sobre fondos oscuros. */
const TEXTO_OSCURO = '#17142b'
const TEXTO_CLARO = '#ffffff'

/** Umbral de luminancia donde el contraste contra blanco iguala al de negro. */
const UMBRAL_LUMINANCIA = 0.179

const HEX_CORTO = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_LARGO = /^#[0-9a-f]{6}$/i
const LOGO_PERMITIDO = /^(https?:\/\/|data:image\/)/i

function normalizarColor(valor: unknown, porDefecto: string): string {
  if (typeof valor !== 'string') return porDefecto

  const limpio = valor.trim()

  if (HEX_CORTO.test(limpio)) {
    const cuerpo = limpio.slice(1).toLowerCase()
    const r = cuerpo.charAt(0)
    const g = cuerpo.charAt(1)
    const b = cuerpo.charAt(2)
    return `#${r}${r}${g}${g}${b}${b}`
  }

  return HEX_LARGO.test(limpio) ? limpio.toLowerCase() : porDefecto
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

/**
 * Texto legible sobre un color de marca arbitrario.
 *
 * Sin esto, un tenant que elige un naranja o un amarillo deja los botones con
 * texto blanco e ilegibles. Es la diferencia entre un demo que resiste cualquier
 * marca y uno que se rompe en la primera reunión.
 */
export function textoSobre(color: string): string {
  const hex = normalizarColor(color, MARCA_POR_DEFECTO.primary)

  const luminancia =
    0.2126 * canalLineal(hex.slice(1, 3)) +
    0.7152 * canalLineal(hex.slice(3, 5)) +
    0.0722 * canalLineal(hex.slice(5, 7))

  return luminancia > UMBRAL_LUMINANCIA ? TEXTO_OSCURO : TEXTO_CLARO
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

  const logo = normalizarLogo(marca?.logoUrl)
  if (logo !== undefined) variables['--brand-logo'] = logo

  return variables
}
