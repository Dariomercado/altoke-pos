import { describe, expect, it } from 'vitest'
import type { Evento } from '@altoke/domain'
import { parsearEvento } from './eventos'

const TENANT = 'tenant-1'
const TERMINAL = 'term-1'
const OCURRIDO_EN = '2026-11-22T10:00:00.000Z'

/** Envoltorio mínimo; cada caso pone su cuerpo igual que hace la caja al escribir el libro. */
function evento(secuencia: number, resto: object): Evento {
  return {
    id: `evt-${secuencia}`,
    tenantId: TENANT,
    terminalId: TERMINAL,
    secuencia,
    ocurridoEn: OCURRIDO_EN,
    schemaVersion: 1,
    ...resto,
  } as Evento
}

/** Un evento de cada tipo de la unión del dominio, tipado como `Evento`: si el dominio cambia, no compila. */
const EVENTOS_DEL_DOMINIO: readonly Evento[] = [
  evento(1, { tipo: 'turno_abierto', turnoId: 'turno-1', fondoCentavos: 50_000 }),
  evento(2, { tipo: 'venta_iniciada', ventaId: 'venta-1', turnoId: 'turno-1' }),
  evento(3, {
    tipo: 'item_agregado',
    ventaId: 'venta-1',
    sku: 'alfajor',
    cantidad: 2,
    precioUnitarioCentavos: 120_000,
  }),
  evento(4, { tipo: 'item_quitado', ventaId: 'venta-1', sku: 'alfajor', cantidad: 1 }),
  evento(5, { tipo: 'item_devuelto', ventaId: 'venta-1', sku: 'alfajor', cantidad: 1, motivo: 'vencido' }),
  evento(6, { tipo: 'descuento', ventaId: 'venta-1', montoCentavos: 10_000, motivo: 'promo' }),
  evento(7, { tipo: 'pago_registrado', ventaId: 'venta-1', medio: 'efectivo', montoCentavos: 120_000 }),
  evento(8, { tipo: 'venta_confirmada', ventaId: 'venta-1', totalCentavos: 120_000 }),
  evento(9, { tipo: 'venta_anulada', ventaId: 'venta-1', motivo: 'error del cajero' }),
  evento(10, { tipo: 'ajuste_stock', sku: 'alfajor', delta: -3, causa: 'merma' }),
  evento(11, { tipo: 'turno_cerrado', turnoId: 'turno-1', declaradoCentavos: 120_000 }),
]

describe('parsearEvento — lo que el dominio produce', () => {
  it('acepta los once tipos del libro y los devuelve sin tocar', () => {
    expect(EVENTOS_DEL_DOMINIO).toHaveLength(11)

    // La asignación es la prueba de tipos: el resultado del parseo se aplica al libro como
    // `Evento` sin castear. Si el schema inventara una forma propia, esto no compilaría.
    const devueltos: Evento[] = EVENTOS_DEL_DOMINIO.map((entrada) => {
      const resultado = parsearEvento(entrada)
      if (!resultado.ok) {
        throw new Error(`el contrato rechazó ${entrada.tipo}: ${resultado.error.error.mensaje}`)
      }
      expect(resultado.dato).toStrictEqual(entrada)
      return resultado.dato
    })

    expect(devueltos).toStrictEqual(EVENTOS_DEL_DOMINIO)
  })
})

/** Un evento válido y completo; los casos negativos cambian un solo campo por vez. */
const VALIDO = evento(1, { tipo: 'ajuste_stock', sku: 'alfajor', delta: 1, causa: 'compra' })

describe('parsearEvento — lo que no puede aceptar', () => {
  it('rechaza un tipo que el dominio no conoce y señala `tipo`', () => {
    const resultado = parsearEvento({ ...VALIDO, tipo: 'tipo_inventado' })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.code).toBe('validacion')
    expect(resultado.error.error.detalle.campo).toBe('tipo')
  })

  it('no acepta `sobreventa_detectada`: ese evento todavía no existe en la unión del dominio', () => {
    // Guardo de T6: cuando el evento se agregue al dominio, este test tiene que cambiar con él.
    // Un contrato no puede ir por delante del libro que valida.
    const resultado = parsearEvento({
      ...VALIDO,
      tipo: 'sobreventa_detectada',
      sku: 'alfajor',
      faltante: 2,
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('tipo')
  })

  it('rechaza una schemaVersion futura en vez de aplicarla con las reglas de otra versión', () => {
    const resultado = parsearEvento({ ...VALIDO, schemaVersion: 2 })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('schemaVersion')
    expect(resultado.error.error.mensaje).toContain('no soportada')
  })

  it.each([0, -1, 2, 1.5, '1'])('rechaza schemaVersion que no es un entero positivo: %s', (invalida) => {
    const resultado = parsearEvento({ ...VALIDO, schemaVersion: invalida })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('schemaVersion')
  })

  it.each([0, -1, 1.5, '1'])('rechaza secuencia que no es un entero positivo: %s', (invalida) => {
    const resultado = parsearEvento({ ...VALIDO, secuencia: invalida })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('secuencia')
  })

  it.each(['id', 'tenantId', 'terminalId', 'ocurridoEn'] as const)(
    'rechaza el envoltorio sin `%s`',
    (campo) => {
      const sinCampo: Record<string, unknown> = { ...VALIDO }
      delete sinCampo[campo]

      const resultado = parsearEvento(sinCampo)

      expect(resultado.ok).toBe(false)
      if (resultado.ok) return
      expect(resultado.error.error.detalle.campo).toBe(campo)
    },
  )

  it('rechaza un `ocurridoEn` que no es una fecha ISO-8601', () => {
    const resultado = parsearEvento({ ...VALIDO, ocurridoEn: 'ayer a la tarde' })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('ocurridoEn')
  })

  it('rechaza un cuerpo al que le falta un campo suyo y señala ese campo', () => {
    const sinSku: Record<string, unknown> = {
      ...VALIDO,
      tipo: 'item_agregado',
      ventaId: 'venta-1',
      cantidad: 1,
      precioUnitarioCentavos: 100,
    }
    delete sinSku.sku

    const resultado = parsearEvento(sinSku)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('sku')
  })

  it.each([
    ['item_agregado con cantidad cero', { tipo: 'item_agregado', ventaId: 'venta-1', sku: 'a', cantidad: 0, precioUnitarioCentavos: 100 }, 'cantidad'],
    ['pago_registrado con medio desconocido', { tipo: 'pago_registrado', ventaId: 'venta-1', medio: 'bitcoin', montoCentavos: 100 }, 'medio'],
    ['ajuste_stock con delta fraccionario', { tipo: 'ajuste_stock', sku: 'a', delta: 0.5, causa: 'merma' }, 'delta'],
    ['turno_abierto con fondo negativo', { tipo: 'turno_abierto', turnoId: 'turno-1', fondoCentavos: -1 }, 'fondoCentavos'],
  ] as const)('rechaza %s y señala `%s`', (_nombre, cuerpo, campo) => {
    const resultado = parsearEvento({ ...VALIDO, ...cuerpo })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe(campo)
  })

  it.each([null, 'un evento', 42, []])('rechaza lo que no es un objeto y llama `cuerpo` al campo: %s', (valor) => {
    const resultado = parsearEvento(valor)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('cuerpo')
  })
})
