// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { entrada, pulso, useMovimiento } from './movimiento'

afterEach(cleanup)

/*
 * jsdom no trae `matchMedia`. Se responde "sí" sólo a la consulta de reducción de movimiento, así
 * que este archivo prueba el cableado real —`useReducedMotion` -> `useMovimiento`— y no el helper
 * con un `false` escrito a mano.
 */
vi.stubGlobal('matchMedia', (consulta: string) => ({
  matches: consulta.includes('prefers-reduced-motion'),
  media: consulta,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
}))

function Sonda(): ReactElement {
  const permitido = useMovimiento()
  const movimiento = entrada(permitido)
  const vuelto = pulso(permitido)

  return (
    <div
      data-testid="sonda"
      data-permitido={String(permitido)}
      data-initial={JSON.stringify(movimiento.initial)}
      data-duracion={String(movimiento.transition.duration)}
      data-vuelto-inicial={JSON.stringify(vuelto.initial)}
      data-vuelto-final={JSON.stringify(vuelto.animate)}
    />
  )
}

describe('movimiento — con prefers-reduced-motion', () => {
  it('apaga los tres momentos: ni desplazamiento, ni escala, ni duración', () => {
    render(<Sonda />)

    const sonda = screen.getByTestId('sonda')
    expect(sonda.dataset['permitido']).toBe('false')
    expect(sonda.dataset['initial']).toBe('false')
    expect(sonda.dataset['duracion']).toBe('0')
    expect(sonda.dataset['vueltoInicial']).toBe('false')
    expect(sonda.dataset['vueltoFinal']).toBe('{"opacity":1}')
  })
})
