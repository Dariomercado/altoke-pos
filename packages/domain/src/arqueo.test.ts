import { describe, expect, it } from 'vitest'
import {
  DENOMINACIONES,
  armarArqueo,
  arqueoDesdeTurno,
  contarDenominaciones,
} from './arqueo'
import type { ResumenTurno } from './eventos'

const RESUMEN: ResumenTurno = {
  turnoId: 'turno-1',
  abierto: true,
  fondoCentavos: 5000,
  declaradoCentavos: null,
  ventasConfirmadas: 2,
  ventasAnuladas: 0,
  totalCentavos: 5500,
  cobradoCentavos: 5500,
  cobradoPorMedio: { efectivo: 4000, tarjeta_manual: 0, transferencia: 0, qr: 1500 },
  diferenciaCentavos: 0,
  unidadesPorSku: {},
}

describe('DENOMINACIONES', () => {
  it('va de mayor a menor, sin repetir y con enteros positivos', () => {
    expect(DENOMINACIONES.length).toBeGreaterThan(5)

    for (const [indice, valor] of DENOMINACIONES.entries()) {
      expect(Number.isInteger(valor), `valor ${valor}`).toBe(true)
      expect(valor).toBeGreaterThan(0)

      const anterior = DENOMINACIONES[indice - 1]
      if (anterior !== undefined) expect(anterior).toBeGreaterThan(valor)
    }

    expect(new Set(DENOMINACIONES).size).toBe(DENOMINACIONES.length)
  })

  it('incluye los billetes y monedas que un kiosco cuenta hoy', () => {
    for (const valorCentavos of [1_000_000, 500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 1_000, 500, 100]) {
      expect(DENOMINACIONES, `falta ${valorCentavos / 100}`).toContain(valorCentavos)
    }
  })
})

describe('contarDenominaciones — el conteo del cajero', () => {
  it('suma cantidad por denominación', () => {
    expect(contarDenominaciones({ 100_000: 2, 20_000: 1, 1_000: 3 })).toBe(223_000)
  })

  it('un cajón vacío suma cero', () => {
    expect(contarDenominaciones({})).toBe(0)
  })

  it('ignora las denominaciones que el cajero no contó', () => {
    expect(contarDenominaciones({ 10_000: 1 })).toBe(10_000)
  })

  it('rechaza cantidades negativas o fraccionarias', () => {
    expect(() => contarDenominaciones({ 10_000: -1 })).toThrow(RangeError)
    expect(() => contarDenominaciones({ 10_000: 1.5 })).toThrow(RangeError)
  })

  it('rechaza una denominación que no existe: un typo acá es plata inventada', () => {
    expect(() => contarDenominaciones({ 3_000: 1 })).toThrow(RangeError)
  })
})

describe('armarArqueo — caja cuadrada, faltante o sobrante', () => {
  it('cuadra cuando lo contado iguala lo esperado', () => {
    expect(armarArqueo({ esperadoCentavos: 9_000, contadoCentavos: 9_000 })).toEqual({
      esperadoCentavos: 9_000,
      contadoCentavos: 9_000,
      diferenciaCentavos: 0,
      estado: 'cuadrado',
    })
  })

  it('marca faltante cuando hay menos plata en el cajón', () => {
    const arqueo = armarArqueo({ esperadoCentavos: 9_000, contadoCentavos: 8_900 })

    expect(arqueo.estado).toBe('faltante')
    expect(arqueo.diferenciaCentavos).toBe(-100)
  })

  it('marca sobrante cuando hay más', () => {
    const arqueo = armarArqueo({ esperadoCentavos: 9_000, contadoCentavos: 9_500 })

    expect(arqueo.estado).toBe('sobrante')
    expect(arqueo.diferenciaCentavos).toBe(500)
  })

  it('rechaza importes que no son centavos enteros no negativos', () => {
    expect(() => armarArqueo({ esperadoCentavos: -1, contadoCentavos: 0 })).toThrow(RangeError)
    expect(() => armarArqueo({ esperadoCentavos: 0, contadoCentavos: 10.5 })).toThrow(RangeError)
  })
})

describe('arqueoDesdeTurno — lo esperado sale del libro, no de la memoria del cajero', () => {
  it('espera el fondo más lo cobrado en efectivo, y nada más', () => {
    // fondo 5000 + efectivo 4000. El QR de 1500 no está en el cajón.
    const arqueo = arqueoDesdeTurno(RESUMEN, { 5_000: 1, 2_000: 2 })

    expect(arqueo.esperadoCentavos).toBe(9_000)
    expect(arqueo.contadoCentavos).toBe(9_000)
    expect(arqueo.estado).toBe('cuadrado')
  })

  it('detecta el faltante de un turno real', () => {
    const arqueo = arqueoDesdeTurno(RESUMEN, { 5_000: 1, 2_000: 1 })

    expect(arqueo.contadoCentavos).toBe(7_000)
    expect(arqueo.estado).toBe('faltante')
    expect(arqueo.diferenciaCentavos).toBe(-2_000)
  })

  it('un turno sin ventas espera sólo el fondo', () => {
    const sinVentas: ResumenTurno = {
      ...RESUMEN,
      ventasConfirmadas: 0,
      totalCentavos: 0,
      cobradoCentavos: 0,
      cobradoPorMedio: { efectivo: 0, tarjeta_manual: 0, transferencia: 0, qr: 0 },
      diferenciaCentavos: 0,
    }

    expect(arqueoDesdeTurno(sinVentas, { 2_000: 2, 1_000: 1 }).esperadoCentavos).toBe(5_000)
  })
})
