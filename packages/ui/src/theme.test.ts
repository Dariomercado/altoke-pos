import { describe, expect, it } from 'vitest'
import tokensCss from './tokens.css?raw'
import {
  CONTENEDORES_DEL_TEMA_CLARO,
  HUECOS_DE_MARCA,
  MARCA_POR_DEFECTO,
  contraste as contrasteWCAG,
  esContrasteLegible,
  textoSobre,
  variablesDeMarca,
} from './theme'

describe('variablesDeMarca', () => {
  it('expone los colores válidos como custom properties', () => {
    const vars = variablesDeMarca({ primary: '#e11d48', accent: '#f97316' })

    expect(vars['--brand-primary']).toBe('#e11d48')
    expect(vars['--brand-accent']).toBe('#f97316')
  })

  it('normaliza notación corta y mayúsculas a seis dígitos minúscula', () => {
    expect(variablesDeMarca({ primary: '#ABC' })['--brand-primary']).toBe('#aabbcc')
  })

  it('cae al valor por defecto sólo en la clave inválida', () => {
    const vars = variablesDeMarca({ primary: 'azul', accent: '#f97316' })

    expect(vars['--brand-primary']).toBe(MARCA_POR_DEFECTO.primary)
    expect(vars['--brand-accent']).toBe('#f97316')
  })

  it('sin marca devuelve los valores por defecto', () => {
    const vars = variablesDeMarca(undefined)

    expect(vars['--brand-primary']).toBe(MARCA_POR_DEFECTO.primary)
    expect(vars['--brand-accent']).toBe(MARCA_POR_DEFECTO.accent)
  })

  it('acepta logos por http, https y data:image', () => {
    expect(variablesDeMarca({ logoUrl: 'https://cdn.test/logo.svg' })['--brand-logo']).toBe(
      'https://cdn.test/logo.svg',
    )
    expect(variablesDeMarca({ logoUrl: 'data:image/png;base64,AAA' })['--brand-logo']).toBe(
      'data:image/png;base64,AAA',
    )
  })

  it('descarta un logo con esquema no permitido', () => {
    expect(variablesDeMarca({ logoUrl: 'javascript:alert(1)' })['--brand-logo']).toBeUndefined()
    expect(variablesDeMarca({ logoUrl: 'file:///etc/passwd' })['--brand-logo']).toBeUndefined()
  })

  it('omite el logo cuando no se provee', () => {
    expect(variablesDeMarca({})['--brand-logo']).toBeUndefined()
  })

  it('emite fondo y tinta normalizados a seis dígitos minúscula', () => {
    const vars = variablesDeMarca({ surface: '#FBF8FF', text: '#123' })

    expect(vars['--brand-surface']).toBe('#fbf8ff')
    expect(vars['--brand-text']).toBe('#112233')
  })

  it('omite fondo y tinta inválidos en vez de inventar un color', () => {
    const vars = variablesDeMarca({ surface: 'blanco', text: '#1234567' })

    expect(vars['--brand-surface']).toBeUndefined()
    expect(vars['--brand-text']).toBeUndefined()
  })
})

describe('textoSobre', () => {
  it('usa tinta oscura sobre fondos claros y blanca sobre fondos oscuros', () => {
    expect(textoSobre('#fbf8ff')).toBe('#17142b')
    expect(textoSobre('#4f46e5')).toBe('#ffffff')
  })

  it('un color inválido cae al primario por defecto en vez de romper', () => {
    expect(textoSobre('azul')).toBe(textoSobre(MARCA_POR_DEFECTO.primary))
  })
})

describe('contraste', () => {
  it('el máximo del estándar es negro sobre blanco', () => {
    expect(contrasteWCAG('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })

  it('un color contra sí mismo no tiene contraste', () => {
    expect(contrasteWCAG('#4f46e5', '#4f46e5')).toBeCloseTo(1, 10)
  })

  it('acepta como legible un par de marca real', () => {
    expect(esContrasteLegible('#17142b', '#fbf8ff')).toBe(true)
  })

  it('rechaza gris sobre gris claro', () => {
    expect(esContrasteLegible('#9a9a9a', '#b0b0b0')).toBe(false)
  })
})

type Declaraciones = Map<string, string>

const LIMPIO = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** Declaraciones de todas las reglas cuyo selector coincide exactamente. */
function declaracionesDe(css: string, selector: string): Declaraciones {
  const declaraciones: Declaraciones = new Map()

  for (const [, selectores = '', cuerpo = ''] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const coincide = selectores
      .split(',')
      .map((parte) => parte.trim())
      .includes(selector)
    if (!coincide) continue

    for (const linea of cuerpo.split(';')) {
      const separador = linea.indexOf(':')
      if (separador === -1) continue
      const nombre = linea.slice(0, separador).trim()
      if (nombre === '') continue
      declaraciones.set(nombre, linea.slice(separador + 1).trim())
    }
  }

  return declaraciones
}

const REFERENCIA = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+?))?\s*\)$/i

function resolver(crudo: string, declaraciones: Declaraciones, origen: string, saltos = 0): string {
  const valor = crudo.trim()
  const referencia = REFERENCIA.exec(valor)
  if (referencia === null) return valor.toLowerCase()
  if (saltos > 8) throw new Error(`var() circular en ${origen}`)

  const [, nombre = '', respaldo] = referencia
  const siguiente = declaraciones.get(nombre) ?? respaldo?.trim()
  if (siguiente === undefined) throw new Error(`Token sin definir: ${nombre} (desde ${origen})`)

  return resolver(siguiente, declaraciones, origen, saltos + 1)
}

/** Valor efectivo de un token, siguiendo var() y sus respaldos. */
function valor(declaraciones: Declaraciones, nombre: string): string {
  const declarado = declaraciones.get(nombre)
  if (declarado === undefined) throw new Error(`Falta el token ${nombre}`)
  return resolver(declarado, declaraciones, nombre)
}

function luminancia(color: string): number {
  const canales = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color.trim().toLowerCase())
  if (canales === null) throw new Error(`Color no soportado: ${color}`)

  const lineal = (octeto: string): number => {
    const srgb = Number.parseInt(octeto, 16) / 255
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }

  return (
    0.2126 * lineal(canales[1] ?? '') +
    0.7152 * lineal(canales[2] ?? '') +
    0.0722 * lineal(canales[3] ?? '')
  )
}

function contraste(a: string, b: string): number {
  const la = luminancia(a)
  const lb = luminancia(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function aPx(medida: string): number {
  const partes = /^(\d+(?:\.\d+)?)(rem|px)$/.exec(medida.trim())
  if (partes === null) throw new Error(`Medida no soportada: ${medida}`)
  const numero = Number.parseFloat(partes[1] ?? '')
  return partes[2] === 'rem' ? numero * 16 : numero
}

const TEMAS = [
  ['claro', ':root'],
  ["oscuro", "[data-theme='dark']"],
] as const

/** Los pares texto/fondo que el POS usa como texto normal: AA exige 4.5:1. */
const PARES_DE_TEXTO = [
  ['--color-on-surface', '--color-surface'],
  ['--color-on-surface', '--color-surface-container-low'],
  ['--color-on-surface-variant', '--color-surface-container'],
  ['--color-on-surface-variant', '--color-surface-container-high'],
  ['--color-on-primary', '--color-primary'],
  ['--color-on-secondary', '--color-secondary'],
  ['--color-on-tertiary', '--color-tertiary'],
  ['--color-on-error', '--color-error'],
  ['--color-on-primary-container', '--color-primary-container'],
  ['--color-on-secondary-container', '--color-secondary-container'],
  ['--color-on-tertiary-container', '--color-tertiary-container'],
  ['--color-on-error-container', '--color-error-container'],
] as const

describe('tokens.css — claro por defecto, oscuro opcional', () => {
  it('sin atributo de tema resuelve la paleta clara', () => {
    const claro = declaracionesDe(LIMPIO, ':root')

    expect(claro.get('color-scheme')).toBe('light')
    expect(luminancia(valor(claro, '--color-surface'))).toBeGreaterThan(0.7)
    expect(luminancia(valor(claro, '--color-on-surface'))).toBeLessThan(0.15)
  })

  it('el tema oscuro es explícito y de verdad oscuro', () => {
    const oscuro = declaracionesDe(LIMPIO, "[data-theme='dark']")

    expect(oscuro.get('color-scheme')).toBe('dark')
    expect(luminancia(valor(oscuro, '--color-surface'))).toBeLessThan(0.1)
    expect(luminancia(valor(oscuro, '--color-on-surface'))).toBeGreaterThan(0.6)
  })

  it('el tema claro se puede pedir por atributo, no sólo por omisión', () => {
    const explicito = declaracionesDe(LIMPIO, "[data-theme='light']")

    expect(explicito.get('color-scheme')).toBe('light')
    expect(explicito.get('--color-surface')).toBe(
      declaracionesDe(LIMPIO, ':root').get('--color-surface'),
    )
  })

  it('ambos temas declaran exactamente el mismo juego de tokens de color y marca', () => {
    const claves = (declaraciones: Declaraciones): string[] =>
      [...declaraciones.keys()]
        .filter((nombre) => nombre.startsWith('--color-') || nombre.startsWith('--brand-'))
        .sort()

    const claro = claves(declaracionesDe(LIMPIO, ':root'))
    const oscuro = claves(declaracionesDe(LIMPIO, "[data-theme='dark']"))

    expect(oscuro).toEqual(claro)
    expect(claro.length).toBeGreaterThan(20)
  })
})

describe('tokens.css — drift de Stitch corregido', () => {
  it('usa los radios que el HTML aplica, no los que declara el .md', () => {
    const claro = declaracionesDe(LIMPIO, ':root')

    expect(claro.get('--radius-xs')).toBe('0.125rem')
    expect(claro.get('--radius-sm')).toBe('0.25rem')
    expect(claro.get('--radius-md')).toBe('0.5rem')
    expect(claro.get('--radius-lg')).toBe('0.75rem')
    expect(claro.get('--radius-full')).toBe('9999px')

    // 0.375rem (6px) es el `md` que el .md declara y que ningún HTML usa.
    expect(LIMPIO).not.toContain('0.375rem')
  })

  it('usa los acentos del HTML y no los de la prosa del .md', () => {
    const oscuro = declaracionesDe(LIMPIO, "[data-theme='dark']")

    expect(valor(oscuro, '--color-surface')).toBe('#0b1326')
    expect(valor(oscuro, '--color-on-surface')).toBe('#dae2fd')
    expect(valor(oscuro, '--color-secondary')).toBe('#6bd8cb')
    expect(valor(oscuro, '--color-tertiary')).toBe('#4edea3')
    expect(valor(oscuro, '--color-error')).toBe('#ffb4ab')
    expect(valor(oscuro, '--color-surface-container')).toBe('#171f33')

    // Colores que sólo existen en la prosa: slate/Tailwind, no los del mockup.
    for (const deriva of [
      '#0d9488',
      '#10b981',
      '#ef4444',
      '#020617',
      '#0f172a',
      '#1e293b',
      '#e2e8f0',
      '#94a3b8',
    ]) {
      expect(LIMPIO.toLowerCase()).not.toContain(deriva)
    }
  })

  it('no oculta las scrollbars, a diferencia del HTML de Stitch', () => {
    expect(LIMPIO).not.toMatch(/scrollbar[^{}]*\{[^}]*display\s*:\s*none/i)
    expect(LIMPIO).toMatch(/scrollbar-width\s*:\s*thin/i)
  })

  it('usa una tinta de placeholder legible en vez del outline-variant del HTML', () => {
    for (const [nombre, selector] of TEMAS) {
      const declaraciones = declaracionesDe(LIMPIO, selector)
      const placeholder = valor(declaraciones, '--color-placeholder')
      const fondo = valor(declaraciones, '--color-surface-container-lowest')

      expect(placeholder, `placeholder en tema ${nombre}`).toBe(
        valor(declaraciones, '--color-on-surface-variant'),
      )
      expect(contraste(placeholder, fondo), `placeholder en tema ${nombre}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('migra la escala tipográfica del diseño, con números tabulares', () => {
    const claro = declaracionesDe(LIMPIO, ':root')

    expect(claro.get('--font-sans')).toContain('Plus Jakarta Sans')
    expect(claro.get('--font-ui')).toContain('Inter')
    expect(claro.get('--font-variant-numeric')).toBe('tabular-nums')
    expect(claro.get('--text-data-pos')).toBe('1.75rem')
    expect(claro.get('--tracking-data-pos')).toBe('-0.02em')
    expect(claro.get('--weight-label-sm')).toBe('700')
  })
})

describe('tokens.css — touch primero y contraste AA', () => {
  it('el target táctil mínimo es de 44px', () => {
    const claro = declaracionesDe(LIMPIO, ':root')
    const minimo = claro.get('--size-touch-min')

    expect(minimo).toBeDefined()
    expect(aPx(minimo ?? '')).toBeGreaterThanOrEqual(44)
  })

  it('cumple AA en todos los pares de texto, en ambos temas', () => {
    const fallos: string[] = []

    for (const [nombre, selector] of TEMAS) {
      const declaraciones = declaracionesDe(LIMPIO, selector)

      for (const [texto, fondo] of PARES_DE_TEXTO) {
        const ratio = contraste(valor(declaraciones, texto), valor(declaraciones, fondo))
        if (ratio < 4.5) {
          fallos.push(`${nombre}: ${texto} sobre ${fondo} = ${ratio.toFixed(2)}:1`)
        }
      }
    }

    expect(fallos).toEqual([])
  })
})

describe('tokens.css — la marca del tenant sólo toca cinco variables', () => {
  it('sin tocar el CSS, la marca llega a los tokens semánticos', () => {
    const declaraciones = declaracionesDe(LIMPIO, ':root')

    for (const [nombre, valorMarca] of Object.entries(
      variablesDeMarca({ primary: '#e11d48', accent: '#f97316' }),
    )) {
      declaraciones.set(nombre, valorMarca)
    }

    expect(valor(declaraciones, '--color-primary')).toBe('#e11d48')
    expect(valor(declaraciones, '--color-secondary')).toBe('#f97316')
    expect(valor(declaraciones, '--color-on-primary')).toBe(textoSobre('#e11d48'))
    expect(valor(declaraciones, '--color-on-secondary')).toBe(textoSobre('#f97316'))
  })

  it('la marca por defecto es la de tokens.css, no una copia', () => {
    const claro = declaracionesDe(LIMPIO, ':root')

    expect(MARCA_POR_DEFECTO.primary).toBe(claro.get('--brand-primary'))
    expect(MARCA_POR_DEFECTO.accent).toBe(claro.get('--brand-accent'))
  })

  it('los contenedores claros que no siguen a la marca son los de tokens.css', () => {
    const claro = declaracionesDe(LIMPIO, ':root')
    const declarados = [
      '--color-surface-container-lowest',
      '--color-surface-container-low',
      '--color-surface-container',
      '--color-surface-container-high',
    ].map((token) => valor(claro, token))

    expect(declarados).toEqual([...CONTENEDORES_DEL_TEMA_CLARO])
  })

  it('declara los cinco huecos de marca y ninguno más', () => {
    const huecos = [...declaracionesDe(LIMPIO, ':root').keys()]
      .filter((nombre) => nombre.startsWith('--brand-'))
      .sort()

    expect(huecos).toEqual([
      '--brand-accent',
      '--brand-logo',
      '--brand-primary',
      '--brand-surface',
      '--brand-text',
    ])
    // El CSS y el código que aplica la marca tienen que declarar los mismos cinco huecos.
    expect([...HUECOS_DE_MARCA].sort()).toEqual(huecos)
  })
})

describe('@altoke/ui — entrada del paquete', () => {
  it('expone la API de marca desde el índice', async () => {
    const paquete = await import('./index')

    expect(paquete.variablesDeMarca).toBe(variablesDeMarca)
    expect(paquete.MARCA_POR_DEFECTO).toBe(MARCA_POR_DEFECTO)
  })
})
