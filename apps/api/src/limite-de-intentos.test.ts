/**
 * El rate limit del login: una ventana fija de intentos **fallidos** por email y cliente.
 *
 * Se prueba con el reloj inyectado y sin HTTP: la cuenta de intentos y el vencimiento de la ventana
 * son lo que hay que fijar, y un `setTimeout` real haría el test lento y frágil.
 */

import { describe, expect, it } from 'vitest'
import { crearLimiteDeIntentos } from './limite-de-intentos.ts'

function reloj(comienzo = Date.UTC(2026, 10, 23, 12, 0, 0)): {
  ahora: () => number
  avanzar: (ms: number) => void
} {
  let instante = comienzo
  return {
    ahora: () => instante,
    avanzar: (ms: number) => {
      instante += ms
    },
  }
}

const VENTANA = 5 * 60_000

describe('crearLimiteDeIntentos', () => {
  it('deja pasar hasta el máximo y después bloquea', () => {
    const limite = crearLimiteDeIntentos({ maximo: 3, ventanaMs: VENTANA, ahora: reloj().ahora })

    expect([1, 2, 3].map(() => limite.intentar('ana').permitido)).toEqual([true, true, true])

    const bloqueado = limite.intentar('ana')
    expect(bloqueado.permitido).toBe(false)
    expect(bloqueado.reintentarEnSegundos).toBeGreaterThan(0)
  })

  it('al vencer la ventana vuelve a dejar pasar', () => {
    const tiempo = reloj()
    const limite = crearLimiteDeIntentos({ maximo: 2, ventanaMs: VENTANA, ahora: tiempo.ahora })

    limite.intentar('ana')
    limite.intentar('ana')
    expect(limite.intentar('ana').permitido).toBe(false)

    tiempo.avanzar(VENTANA)

    expect(limite.intentar('ana')).toEqual({ permitido: true, reintentarEnSegundos: 0 })
  })

  it('un acierto borra la cuenta: quien entró no arrastra los intentos previos', () => {
    const limite = crearLimiteDeIntentos({ maximo: 2, ventanaMs: VENTANA, ahora: reloj().ahora })

    limite.intentar('ana')
    limite.intentar('ana')
    limite.registrarExito('ana')

    expect([1, 2].map(() => limite.intentar('ana').permitido)).toEqual([true, true])
  })

  it('cada clave lleva su cuenta: bloquear a una no bloquea a la otra', () => {
    const limite = crearLimiteDeIntentos({ maximo: 1, ventanaMs: VENTANA, ahora: reloj().ahora })

    limite.intentar('ana')
    expect(limite.intentar('ana').permitido).toBe(false)
    expect(limite.intentar('beto').permitido).toBe(true)
  })

  it('la ventana empieza con el primer intento, no corre de a uno', () => {
    const tiempo = reloj()
    const limite = crearLimiteDeIntentos({ maximo: 2, ventanaMs: VENTANA, ahora: tiempo.ahora })

    limite.intentar('ana')
    tiempo.avanzar(VENTANA - 1)
    limite.intentar('ana')
    // El segundo intento no renueva la ventana: a los 5 minutos del primero se suelta.
    tiempo.avanzar(1)

    expect(limite.intentar('ana').permitido).toBe(true)
  })

  it('no acumula claves para siempre: la más vieja se desaloja al llegar a la capacidad', () => {
    const limite = crearLimiteDeIntentos({
      maximo: 1,
      ventanaMs: VENTANA,
      ahora: reloj().ahora,
      capacidad: 2,
    })

    limite.intentar('ana')
    limite.intentar('beto')
    limite.intentar('caro')

    expect(limite.tamano()).toBe(2)
    // `ana` fue la primera en irse: su cuenta arranca de cero.
    expect(limite.intentar('ana').permitido).toBe(true)
  })
})
