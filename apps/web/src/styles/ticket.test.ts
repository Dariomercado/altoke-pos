import { describe, expect, it } from 'vitest'
// `packages/ui/src/css.d.ts` declara `*.css?raw`, no `*.tsx?raw`: el import funciona en Vite y en
// vitest, pero `tsc` no lo resuelve. El `expect-error` documenta el hueco y, si algún día se declara,
// el typecheck avisa que esta línea ya no hace falta.
// @ts-expect-error — la declaración de `?raw` sólo cubre CSS.
import fuenteDelTicket from '../components/Ticket.tsx?raw'
import ticketCss from './ticket.css?raw'

/**
 * Contrato de impresión del ticket de 80 mm (T7, invariante "Ticket de 80 mm").
 *
 * Se lee el archivo como texto y no el CSS que el navegador aplique: `@page` y las reglas de
 * `@media print` no existen en jsdom, así que montar la pantalla no probaría nada de esto. Un
 * regex sobre el texto sí falla cuando alguien toca las medidas, que es lo que se quiere pinchar.
 *
 * `ticket.css?raw` está declarado en `packages/ui/src/css.d.ts`. La fuente del componente entra por
 * el mismo camino, así que los dos archivos se leen con el mismo mecanismo y sin permisos de
 * filesystem.
 */

/** Sin comentarios: los comentarios de `ticket.css` citan las medidas a propósito. */
const ticketSinComentarios = ticketCss.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Las reglas de pantalla y las de impresión, separadas.
 *
 * `@page` y `.ticket` viven fuera del `@media print`; `.pantalla-ticket` y la excepción de
 * visibilidad viven adentro. Si el bloque de impresión desapareciera, el split dejaría la mitad
 * de la derecha vacía y los tests de abajo pasarían sobre la nada: por eso se guarda que no lo esté.
 */
const [cssDePantalla = '', cssDeImpresion = ''] = ticketSinComentarios.split('@media print')

/** El contenido de un bloque `selector { … }`. El CSS del ticket no anida bloques. */
function bloque(css: string, selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const encontrado = new RegExp(`${escapado}\\s*\\{([^}]*)\\}`).exec(css)
  if (encontrado === null) {
    throw new Error(`ticket.css no tiene el bloque ${selector}`)
  }
  return encontrado[1] ?? ''
}

describe('ticket de 80 mm — contrato de impresión', () => {
  it('el CSS y la fuente del ticket llegan con contenido', () => {
    // Un `?raw` que llega vacío haría pasar todos los regex de abajo sobre la nada.
    expect(ticketCss.trim().length).toBeGreaterThan(0)
    expect(fuenteDelTicket.trim().length).toBeGreaterThan(0)
    expect(cssDePantalla.trim().length).toBeGreaterThan(0)
    // Sin bloque `@media print`, la mitad de impresión queda vacía.
    expect(cssDeImpresion.trim().length).toBeGreaterThan(0)
  })

  it('el papel declarado es de 80 mm con alto automático', () => {
    expect(bloque(cssDePantalla, '@page')).toMatch(/size:\s*80mm\s+auto/)
  })

  it('el ticket mide 72 mm de ancho útil', () => {
    expect(bloque(cssDePantalla, '.ticket')).toMatch(/width:\s*72mm/)
  })

  it('al imprimir la pantalla del ticket deja de ser una capa fija', () => {
    expect(bloque(cssDeImpresion, '.pantalla-ticket')).toMatch(/position:\s*static/)
  })

  it('al imprimir lo único visible es el ticket', () => {
    // Dos selectores en el mismo bloque y separados por un salto de línea: el regex tolera el
    // espacio que haya entre ellos en vez de fijar el formato del archivo.
    expect(cssDeImpresion).toMatch(
      /\.ticket\s*,\s*\.ticket\s+\*\s*\{[^}]*visibility:\s*visible/,
    )
  })

  it('el componente declara que es un ticket interno y no un comprobante fiscal', () => {
    expect(fuenteDelTicket).toContain('TICKET INTERNO — no es comprobante fiscal válido')
  })
})
