import { describe, expect, it } from 'vitest'
import {
  centavosDesdePesos,
  formatearCentavos,
  formatearFechaHora,
  pesosDesdeCentavos,
} from './formato'

describe('formato de plata', () => {
  it('muestra los centavos como pesos argentinos con dos decimales', () => {
    expect(formatearCentavos(1210)).toContain('12,10')
    expect(formatearCentavos(0)).toContain('0,00')
    expect(formatearCentavos(123456)).toContain('1.234,56')
    expect(formatearCentavos(1210)).toContain('$')
  })

  it('muestra el faltante de un arqueo con signo', () => {
    expect(formatearCentavos(-1210)).toContain('12,10')
    expect(formatearCentavos(-1210).startsWith('-$')).toBe(true)
  })

  it('escribe el valor de un input en pesos con coma decimal', () => {
    expect(pesosDesdeCentavos(5000)).toBe('50,00')
    expect(pesosDesdeCentavos(1210)).toBe('12,10')
    expect(pesosDesdeCentavos(5)).toBe('0,05')
    expect(pesosDesdeCentavos(0)).toBe('0,00')
  })

  it('lee el input del cajero en pesos y devuelve centavos enteros', () => {
    expect(centavosDesdePesos('24,20')).toBe(2420)
    expect(centavosDesdePesos('24.20')).toBe(2420)
    expect(centavosDesdePesos(' 50 ')).toBe(5000)
    expect(centavosDesdePesos('0,5')).toBe(50)
    expect(centavosDesdePesos('24,')).toBe(2400)
    expect(centavosDesdePesos('')).toBeNull()
    expect(centavosDesdePesos('doce')).toBeNull()
    expect(centavosDesdePesos('-5')).toBeNull()
    expect(centavosDesdePesos('1,234')).toBeNull()
  })
})

describe('formato de fecha y hora', () => {
  it('muestra una fecha ISO en hora argentina', () => {
    const texto = formatearFechaHora('2026-11-22T10:00:00.000Z')

    expect(texto).toContain('22/11/26')
    expect(texto).toContain('7:00')
  })

  it('no rompe con una fecha inválida', () => {
    expect(formatearFechaHora('no-es-fecha')).toBe('no-es-fecha')
  })
})
