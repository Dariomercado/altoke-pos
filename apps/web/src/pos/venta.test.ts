import { describe, expect, it } from 'vitest'
import { ALICUOTAS_IVA } from '@altoke/domain'
import { ALICUOTA_KIOSCO, calcularTotales, importeLineaCentavos } from './venta'
import type { LineaDeVenta } from './venta'

function linea(cantidad: number, precioUnitarioCentavos: number, alicuotaBps = ALICUOTA_KIOSCO): LineaDeVenta {
  return { sku: 'alfajor', nombre: 'Alfajor', cantidad, precioUnitarioCentavos, alicuotaBps }
}

describe('importeLineaCentavos', () => {
  it('multiplica precio por cantidad en centavos enteros', () => {
    expect(importeLineaCentavos(linea(2, 1200))).toBe(2400)
  })

  it('rechaza cantidades que no son enteros positivos', () => {
    expect(() => importeLineaCentavos(linea(0, 1200))).toThrow(RangeError)
    expect(() => importeLineaCentavos(linea(1.5, 1200))).toThrow(RangeError)
  })

  it('rechaza un precio inválido', () => {
    expect(() => importeLineaCentavos(linea(1, -1))).toThrow(RangeError)
    expect(() => importeLineaCentavos(linea(1, 12.5))).toThrow(RangeError)
  })
})

describe('calcularTotales', () => {
  it('sin líneas no hay total', () => {
    expect(calcularTotales([])).toEqual({ totalCentavos: 0, ivaCentavos: 0, netoCentavos: 0 })
  })

  it('suma las líneas', () => {
    const totales = calcularTotales([linea(2, 1200), linea(1, 1500)])

    expect(totales.totalCentavos).toBe(3900)
  })

  it('desglosa el IVA contenido, no lo suma arriba del precio de góndola', () => {
    // 2 × 12,10 ya incluye 21%: el total es 24,20 y el IVA contenido, 4,20.
    const totales = calcularTotales([linea(2, 1210)])

    expect(totales).toEqual({ totalCentavos: 2420, ivaCentavos: 420, netoCentavos: 2000 })
  })

  it('agrupa por alícuota antes de redondear', () => {
    const totales = calcularTotales([
      linea(2, 1210, ALICUOTAS_IVA.general),
      linea(1, 1105, ALICUOTAS_IVA.reducida),
    ])

    // 24,20 al 21% (IVA 4,20) + 11,05 al 10,5% (IVA 1,05).
    expect(totales).toEqual({ totalCentavos: 3525, ivaCentavos: 525, netoCentavos: 3000 })
  })

  it('no pierde centavos entre el neto y el IVA', () => {
    const totales = calcularTotales([linea(3, 999), linea(1, 1111)])

    expect(totales.netoCentavos + totales.ivaCentavos).toBe(totales.totalCentavos)
  })

  it('el total no depende de cómo se agrupen las líneas del mismo SKU', () => {
    const juntas = calcularTotales([linea(3, 1200)])
    const separadas = calcularTotales([linea(1, 1200), linea(2, 1200)])

    expect(separadas).toEqual(juntas)
  })
})
