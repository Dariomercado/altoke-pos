import { describe, expect, it } from 'vitest'
import {
  ESTADOS_EMISION,
  MODOS_FISCALES,
  emisionInicial,
  esReintentoVencido,
  marcarEmitida,
  marcarFallida,
  puedeTransicionar,
  programarReintento,
  requiereEmisionFiscal,
} from './fiscal.ts'
import type { EmisionFiscal } from './fiscal.ts'

const AHORA = '2026-11-22T10:00:00.000Z'
const EN_CINCO_MINUTOS = '2026-11-22T10:05:00.000Z'

/** Una emisión recién encolada: es el estado en el que la deja el cobro. */
function pendiente(): EmisionFiscal {
  return emisionInicial({
    id: 'out-1',
    tenantId: 'kiosco-1',
    ventaId: 'venta-1',
    creadoEn: AHORA,
  })
}

describe('fiscal — la emisión inicial', () => {
  it('nace pendiente, sin intentos, sin motivo y con el primer intento ya vencido', () => {
    expect(pendiente()).toEqual({
      id: 'out-1',
      tenantId: 'kiosco-1',
      ventaId: 'venta-1',
      estado: 'pendiente',
      intentos: 0,
      proximoIntentoEn: AHORA,
      motivo: null,
      creadoEn: AHORA,
    })

    // El primer intento no se programa para más adelante: está vencido desde que existe.
    expect(esReintentoVencido(pendiente(), AHORA)).toBe(true)
    expect(esReintentoVencido(pendiente(), '2026-11-22T09:59:59.999Z')).toBe(false)
  })

  it('exige la venta, el tenant y una fecha ISO', () => {
    const datos = { id: 'out-1', tenantId: 'kiosco-1', ventaId: 'venta-1', creadoEn: AHORA }

    expect(() => emisionInicial({ ...datos, id: '  ' })).toThrow(/id/)
    expect(() => emisionInicial({ ...datos, tenantId: '' })).toThrow(/tenantId/)
    expect(() => emisionInicial({ ...datos, ventaId: '' })).toThrow(/ventaId/)
    expect(() => emisionInicial({ ...datos, creadoEn: 'ayer' })).toThrow(/ISO-8601/)
  })
})

describe('fiscal — qué puede moverse a qué', () => {
  it('la matriz es pendiente → emitido | fallido, y fallido → pendiente', () => {
    const permitidas = ESTADOS_EMISION.flatMap((desde) =>
      ESTADOS_EMISION.filter((hacia) => puedeTransicionar(desde, hacia)).map(
        (hacia) => `${desde}>${hacia}`,
      ),
    )

    expect(permitidas).toEqual(['pendiente>emitido', 'pendiente>fallido', 'fallido>pendiente'])
  })

  it('emitido es final: corregir es una nota de crédito, no un UPDATE', () => {
    const emitida = marcarEmitida(pendiente())

    expect(() => marcarEmitida(emitida)).toThrow(/emitido/)
    expect(() => marcarFallida(emitida, { motivo: 'tarde' })).toThrow(/emitido/)
    expect(() => programarReintento(emitida, EN_CINCO_MINUTOS)).toThrow(/emitido/)
  })

  it('un fallido vuelve a pendiente antes de poder emitirse', () => {
    const fallida = marcarFallida(pendiente(), { motivo: 'impresora apagada' })

    expect(() => marcarEmitida(fallida)).toThrow(/fallido/)
  })

  it('rechaza un estado que no existe', () => {
    expect(() => puedeTransicionar('reemplazado' as never, 'emitido')).toThrow(/reemplazado/)
  })
})

describe('fiscal — el intento y el reintento', () => {
  it('emitir cuenta el intento, limpia el motivo y no deja nada programado', () => {
    const emitida = marcarEmitida(pendiente())

    expect(emitida).toMatchObject({
      estado: 'emitido',
      intentos: 1,
      motivo: null,
      proximoIntentoEn: null,
    })
    expect(esReintentoVencido(emitida, EN_CINCO_MINUTOS)).toBe(false)
  })

  it('fallar cuenta el intento y guarda el motivo', () => {
    const fallida = marcarFallida(pendiente(), {
      motivo: 'el controlador no responde',
      proximoIntentoEn: EN_CINCO_MINUTOS,
    })

    expect(fallida).toMatchObject({
      estado: 'fallido',
      intentos: 1,
      motivo: 'el controlador no responde',
      proximoIntentoEn: EN_CINCO_MINUTOS,
    })
    // Un `fallido` no es un reintento pendiente: primero hay que reprogramarlo.
    expect(esReintentoVencido(fallida, EN_CINCO_MINUTOS)).toBe(false)
  })

  it('un fallo sin fecha no está vencido: espera acción humana', () => {
    const fallida = marcarFallida(pendiente(), { motivo: 'sin CAE' })

    expect(fallida.proximoIntentoEn).toBeNull()
    expect(esReintentoVencido(fallida, EN_CINCO_MINUTOS)).toBe(false)
  })

  it('reprogramar devuelve el fallido a pendiente, conserva el motivo y vence a su hora', () => {
    const fallida = marcarFallida(pendiente(), { motivo: 'sin red' })
    const reprogramada = programarReintento(fallida, EN_CINCO_MINUTOS)

    expect(reprogramada).toMatchObject({
      estado: 'pendiente',
      intentos: 1,
      motivo: 'sin red',
      proximoIntentoEn: EN_CINCO_MINUTOS,
    })
    expect(esReintentoVencido(reprogramada, AHORA)).toBe(false)
    expect(esReintentoVencido(reprogramada, EN_CINCO_MINUTOS)).toBe(true)

    // El segundo intento se cuenta sobre el primero: no se reinicia el contador.
    expect(marcarEmitida(reprogramada).intentos).toBe(2)
  })

  it('un fallo sin motivo no es un fallo: no se puede reintentar lo que no se sabe qué pasó', () => {
    expect(() => marcarFallida(pendiente(), { motivo: '   ' })).toThrow(/motivo/)
  })

  it('exige fechas ISO en lo que se programa', () => {
    expect(() =>
      marcarFallida(pendiente(), { motivo: 'sin red', proximoIntentoEn: 'mañana' }),
    ).toThrow(/ISO-8601/)
    expect(() => programarReintento(marcarFallida(pendiente(), { motivo: 'x' }), 'mañana')).toThrow(
      /ISO-8601/,
    )
    expect(() => esReintentoVencido(pendiente(), 'ahora')).toThrow(/ISO-8601/)
  })
})

describe('fiscal — F0 no emite comprobante', () => {
  it('los modos son los del CHECK de la tabla, no las etiquetas F0–F3', () => {
    expect(MODOS_FISCALES).toEqual(['ninguno', 'controlador_fiscal', 'factura_electronica'])
  })

  it('sólo `ninguno` (F0) se queda sin emisión fiscal', () => {
    expect(requiereEmisionFiscal('ninguno')).toBe(false)
    expect(requiereEmisionFiscal('controlador_fiscal')).toBe(true)
    expect(requiereEmisionFiscal('factura_electronica')).toBe(true)
    expect(() => requiereEmisionFiscal('F0' as never)).toThrow(/Modo fiscal desconocido/)
  })
})
