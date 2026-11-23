import { describe, expect, it } from 'vitest'
import { entrada, pulso } from './movimiento'

describe('movimiento — el sistema de diseño manda', () => {
  it('la entrada es un desplazamiento corto con `ease-out`, no un rebote', () => {
    const movimiento = entrada(true)

    expect(movimiento.initial).toEqual({ opacity: 0, y: 12 })
    expect(movimiento.animate).toEqual({ opacity: 1, y: 0 })
    expect(movimiento.transition.duration).toBe(0.22)
    expect(movimiento.transition.ease).toEqual([0.215, 0.61, 0.355, 1])
  })

  it('sin permiso para animar arranca en el estado final: mismo árbol, sin coreografía', () => {
    const movimientos = [entrada(false), entrada(false, { escalaInicial: 0.96 }), pulso(false)]

    for (const movimiento of movimientos) {
      expect(movimiento.initial).toBe(false)
      expect(movimiento.transition.duration).toBe(0)
    }
  })

  it('usa las duraciones del sistema: micro 150 ms, UI 220 ms, overlay 280 ms', () => {
    expect(entrada(true, { duracion: 'micro' }).transition.duration).toBe(0.15)
    expect(entrada(true, { duracion: 'ui' }).transition.duration).toBe(0.22)
    expect(entrada(true, { duracion: 'overlay' }).transition.duration).toBe(0.28)
    expect(pulso(true).transition.duration).toBe(0.15)
  })
})
