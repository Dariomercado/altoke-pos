import { describe, expect, it } from 'vitest'
import {
  ALICUOTAS_IVA,
  desglosarIva,
  esCentavos,
  importeConIva,
  redondearMitadArriba,
} from './dinero'

describe('esCentavos', () => {
  it('acepta enteros no negativos', () => {
    expect(esCentavos(0)).toBe(true)
    expect(esCentavos(1210)).toBe(true)
  })

  it('rechaza todo lo que no sea un entero representable', () => {
    for (const invalido of [12.5, Number.NaN, Number.POSITIVE_INFINITY, -1, '100', null]) {
      expect(esCentavos(invalido), `debería rechazar ${String(invalido)}`).toBe(false)
    }
  })
})

describe('redondearMitadArriba', () => {
  it('redondea el medio centavo hacia arriba', () => {
    expect(redondearMitadArriba(1, 2)).toBe(1)
    expect(redondearMitadArriba(3, 2)).toBe(2)
    expect(redondearMitadArriba(5, 2)).toBe(3)
  })

  it('redondea hacia abajo por debajo del medio', () => {
    expect(redondearMitadArriba(4, 2)).toBe(2)
    expect(redondearMitadArriba(1, 3)).toBe(0)
    expect(redondearMitadArriba(7, 3)).toBe(2)
  })

  it('redondea hacia arriba por encima del medio', () => {
    expect(redondearMitadArriba(2, 3)).toBe(1)
    expect(redondearMitadArriba(8, 3)).toBe(3)
  })

  it('es simétrico en signo: el medio se aleja de cero', () => {
    expect(redondearMitadArriba(-1, 2)).toBe(-1)
    expect(redondearMitadArriba(-5, 2)).toBe(-3)
    expect(redondearMitadArriba(-4, 2)).toBe(-2)
  })

  it('rechaza un denominador no positivo', () => {
    expect(() => redondearMitadArriba(1, 0)).toThrow(RangeError)
    expect(() => redondearMitadArriba(1, -2)).toThrow(RangeError)
  })
})

describe('desglosarIva — el precio de góndola ya incluye IVA', () => {
  it('invierte el 21% en vez de sumarlo al neto', () => {
    expect(desglosarIva(1210, ALICUOTAS_IVA.general)).toEqual({
      netoCentavos: 1000,
      ivaCentavos: 210,
    })
  })

  it('invierte el 10,5%', () => {
    expect(desglosarIva(1000, ALICUOTAS_IVA.reducida)).toEqual({
      netoCentavos: 905,
      ivaCentavos: 95,
    })
  })

  it('con alícuota cero el total es el neto', () => {
    expect(desglosarIva(1000, ALICUOTAS_IVA.cero)).toEqual({ netoCentavos: 1000, ivaCentavos: 0 })
  })

  it('la suma de neto e IVA siempre da el total, sin perder un centavo', () => {
    for (const alicuota of Object.values(ALICUOTAS_IVA)) {
      for (const total of [0, 1, 7, 99, 1000, 1210, 4999, 123456]) {
        const { netoCentavos, ivaCentavos } = desglosarIva(total, alicuota)
        expect(netoCentavos + ivaCentavos, `total ${total} @ ${alicuota}bps`).toBe(total)
        expect(ivaCentavos, `total ${total} @ ${alicuota}bps`).toBe(
          redondearMitadArriba(total * alicuota, 10000 + alicuota),
        )
      }
    }
  })

  it('rechaza totales negativos: una devolución es otro documento, no un total en contra', () => {
    expect(() => desglosarIva(-1, ALICUOTAS_IVA.general)).toThrow(RangeError)
  })

  it('rechaza alícuotas fuera de rango o no enteras', () => {
    expect(() => desglosarIva(1000, -1)).toThrow(RangeError)
    expect(() => desglosarIva(1000, 10001)).toThrow(RangeError)
    expect(() => desglosarIva(1000, 21.5)).toThrow(RangeError)
  })

  it('rechaza totales con centavos fraccionarios', () => {
    expect(() => desglosarIva(10.5, ALICUOTAS_IVA.general)).toThrow(RangeError)
  })
})

describe('importeConIva — neto más IVA, redondeado al centavo', () => {
  it('suma el 21% sobre el neto', () => {
    expect(importeConIva(1000, ALICUOTAS_IVA.general)).toBe(1210)
  })

  it('redondea el medio centavo hacia arriba', () => {
    expect(importeConIva(999, ALICUOTAS_IVA.general)).toBe(1209)
    expect(importeConIva(50, ALICUOTAS_IVA.general)).toBe(61)
  })

  it('vuelve al neto original al desglosar, en todo el rango razonable', () => {
    for (const alicuota of Object.values(ALICUOTAS_IVA)) {
      for (const neto of [0, 1, 3, 50, 999, 1000, 4321, 99999]) {
        const total = importeConIva(neto, alicuota)
        expect(desglosarIva(total, alicuota).netoCentavos, `neto ${neto} @ ${alicuota}bps`).toBe(neto)
      }
    }
  })
})
