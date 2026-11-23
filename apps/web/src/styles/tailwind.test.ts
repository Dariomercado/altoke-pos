import { describe, expect, it } from 'vitest'
import { CONTENEDORES_DEL_TEMA_CLARO } from '@altoke/ui'
import tailwindCss from './tailwind.css?raw'
import tokensCss from '../../../../packages/ui/src/tokens.css?raw'

/**
 * Contrato de la capa de Tailwind.
 *
 * Todo lo de acá falla SILENCIOSAMENTE si se rompe: un alias autorreferente o un
 * `var(--token)` con typo compila a una utilidad inválida, el build pasa, y la
 * pantalla queda con un color o un radio que nadie pidió. Ninguno de esos casos
 * lo detecta TypeScript ni el parser de CSS.
 */

/** Declaraciones `--nombre: valor;` de un bloque, sin comentarios. */
function declaraciones(css: string): Map<string, string> {
  const salida = new Map<string, string>()
  const limpio = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, nombre, valor] of limpio.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    if (nombre === undefined || valor === undefined) continue
    // La primera aparición gana: en tokens.css cada tema redeclara los mismos
    // nombres y acá sólo interesa que exista una declaración válida.
    if (!salida.has(nombre)) salida.set(nombre, valor.trim())
  }
  return salida
}

const tokens = declaraciones(tokensCss)
const tema = declaraciones(tailwindCss)
/** Sin comentarios: los comentarios de este archivo citan tokens a propósito. */
const temaSinComentarios = tailwindCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('capa de Tailwind v4', () => {
  it('no entra en tokens.css, que se testea como texto', () => {
    // theme.test.ts parsea tokens.css con un regex de bloques que no soporta
    // at-rules anidados, y además la paleta default de Tailwind choca con sus
    // prohibiciones de hex.
    expect(tokensCss).not.toMatch(/@import\s+["']tailwindcss["']/)
  })

  it('usa @theme inline para no congelar los valores de marca en build', () => {
    expect(temaSinComentarios).toMatch(/@theme\s+inline\s*\{/)
  })

  it('ningún alias se referencia a sí mismo', () => {
    const ciclos = [...tema.entries()]
      .filter(([nombre, valor]) => valor.replace(/\s/g, '') === `var(${nombre})`)
      .map(([nombre]) => nombre)
    expect(ciclos).toEqual([])
  })

  it('cada var() del @theme apunta a un token que existe', () => {
    const referencias = [...temaSinComentarios.matchAll(/var\((--[a-z0-9-]+)\)/g)]
      .map(m => m[1])
      .filter((nombre): nombre is string => nombre !== undefined)
    expect(referencias.length).toBeGreaterThan(15)
    const huerfanos = [...new Set(referencias)].filter(nombre => !tokens.has(nombre))
    expect(huerfanos).toEqual([])
  })

  it('los radios coinciden con tokens.css', () => {
    // Dos fuentes para los mismos radios: si divergen, `rounded-md` deja de
    // medir lo que mide el resto del sistema.
    const radios = ['--radius-xs', '--radius-sm', '--radius-md', '--radius-lg'] as const
    for (const radio of radios) {
      expect(tema.get(radio), `${radio} falta en tailwind.css`).toBe(tokens.get(radio))
    }
  })

  it('el tema oscuro se activa con data-theme, no con prefers-color-scheme', () => {
    expect(temaSinComentarios).toMatch(/@custom-variant\s+dark\s*\(\s*&:where\(\[data-theme=['"]dark['"]\]/)
  })

  /*
   * Este es el test que evita que el guard de contraste quede decorativo.
   *
   * El guard de marca valida la tinta del tenant contra una lista fija de
   * superficies (CONTENEDORES_DEL_TEMA_CLARO). Si el rediseño pinta texto sobre
   * una superficie que no está en esa lista, el guard sigue aprobando marcas que
   * en pantalla son ilegibles.
   */
  it('toda superficie que lleva la tinta del tenant está cubierta por el guard', () => {
    const cubiertas = new Set<string>(CONTENEDORES_DEL_TEMA_CLARO.map(hex => hex.toLowerCase()))
    const conTintaDelTenant = [
      '--color-card',
      '--color-popover',
      '--color-muted',
      '--color-sunken',
      '--color-sunken-deep',
    ] as const

    for (const alias of conTintaDelTenant) {
      const referencia = tema.get(alias)?.match(/var\((--[a-z0-9-]+)\)/)?.[1]
      expect(referencia, `${alias} no apunta a un token`).toBeDefined()
      const hex = tokens.get(referencia ?? '')?.toLowerCase()
      expect(hex, `${referencia} no declara un valor en tokens.css`).toBeDefined()
      expect(
        cubiertas.has(hex ?? ''),
        `${alias} → ${referencia} (${hex}) no está en CONTENEDORES_DEL_TEMA_CLARO: el guard no la valida`,
      ).toBe(true)
    }
  })

  it('el fondo sigue siendo el hueco de marca, no un hex fijo', () => {
    // Si `background` se congelara, la marca del tenant no pintaría el fondo.
    expect(tema.get('--color-background')).toBe('var(--color-surface)')
  })
})
