import { useReducedMotion } from 'motion/react'

/**
 * Movimiento del POS (T8): los tres momentos que existen, y nada más.
 *
 * El diseño manda (`design/system.md` § Movimiento): sólo `transform` y `opacity`, micro 100–150 ms,
 * UI 150–250 ms, overlays 250–300 ms, `ease-out` para entrar. Un POS no se anima para lucirse: se
 * anima para que el cajero vea **qué cambió** sin leer la pantalla otra vez.
 *
 *   M1 · entrar a la venta        la bandeja aparece completa, 12 px desde abajo
 *   M2 · el vuelto responde       la cifra hace un micro-pulso cuando cambia el monto
 *   M3 · el resultado aparece     ticket y veredicto del arqueo entran al confirmar
 *
 * Con `prefers-reduced-motion: reduce` los tres devuelven `initial: false`, que en Motion significa
 * "empezá en el estado final": cero desplazamiento, cero escala, cero animación. No hay una segunda
 * versión de la pantalla para esos usuarios, sólo el mismo árbol sin coreografía.
 */

const DURACION_MICRO = 0.15
const DURACION_UI = 0.22
const DURACION_OVERLAY = 0.28

/** `ease-out` de entrada: arranca rápido y frena, que es como se siente un dedo sobre el vidrio. */
const CURVA_ENTRADA = [0.215, 0.61, 0.355, 1] as const

/** Motion pide la bezier como tupla mutable de cuatro números; el token es `readonly`. */
type Curva = [number, number, number, number]

function curvaDeEntrada(): Curva {
  return [CURVA_ENTRADA[0], CURVA_ENTRADA[1], CURVA_ENTRADA[2], CURVA_ENTRADA[3]]
}

/** ¿Se permite animar? Es la única pregunta que hacen los tres momentos. */
export function useMovimiento(): boolean {
  return useReducedMotion() !== true
}

export interface Entrada {
  readonly initial: false | { readonly opacity?: number; readonly y?: number; readonly scale?: number }
  readonly animate: { readonly opacity: number; readonly y?: number; readonly scale?: number }
  readonly transition: { readonly duration: number; readonly ease?: Curva }
}

export interface OpcionesDeEntrada {
  /** De dónde entra: `abajo` para la bandeja, `ninguna` para lo que sólo aparece. */
  readonly desde?: 'abajo' | 'ninguna'
  readonly escalaInicial?: number
  readonly duracion?: 'micro' | 'ui' | 'overlay'
}

/** M1 y M3: la entrada de una pantalla o de un resultado. Siempre `ease-out`. */
export function entrada(permitido: boolean, opciones: OpcionesDeEntrada = {}): Entrada {
  const { desde = 'abajo', escalaInicial = 1, duracion = 'ui' } = opciones

  if (!permitido) {
    return { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
  }

  return {
    initial: {
      opacity: 0,
      ...(desde === 'abajo' ? { y: 12 } : {}),
      ...(escalaInicial !== 1 ? { scale: escalaInicial } : {}),
    },
    animate: {
      opacity: 1,
      ...(desde === 'abajo' ? { y: 0 } : {}),
      ...(escalaInicial !== 1 ? { scale: 1 } : {}),
    },
    transition: { duration: duracionEnSegundos(duracion), ease: curvaDeEntrada() },
  }
}

/**
 * M2: el micro-pulso de una cifra que cambia.
 *
 * Se monta de nuevo por `key` sobre el monto, así que no hace falta comparar valores a mano: si el
 * número es otro, es otro elemento para React y el pulso cuenta la diferencia.
 */
export function pulso(permitido: boolean): Entrada {
  if (!permitido) {
    return { initial: false, animate: { opacity: 1 }, transition: { duration: 0 } }
  }

  return {
    initial: { opacity: 0.5, scale: 0.94 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: DURACION_MICRO, ease: curvaDeEntrada() },
  }
}

function duracionEnSegundos(duracion: 'micro' | 'ui' | 'overlay'): number {
  if (duracion === 'micro') return DURACION_MICRO
  if (duracion === 'overlay') return DURACION_OVERLAY

  return DURACION_UI
}
