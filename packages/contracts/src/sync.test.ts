import { describe, expect, it } from 'vitest'
import type { Evento } from '@altoke/domain'
import {
  parsearSyncEmpujarRespuesta,
  parsearSyncEmpujarSolicitud,
  parsearSyncTraerConsulta,
  parsearSyncTraerRespuesta,
} from './sync'

const TENANT = 'tenant-1'
const TERMINAL = 'term-1'

function evento(secuencia: number, resto: object = {}): Record<string, unknown> {
  return {
    id: `evt-${secuencia}`,
    tenantId: TENANT,
    terminalId: TERMINAL,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta: 1,
    causa: 'compra',
    ...resto,
  }
}

const ACUSE = { terminalId: TERMINAL, ultimaSecuencia: 3 }

describe('syncEmpujarSolicitud', () => {
  it('parsea una solicitud de empuje válida', () => {
    const solicitud = { terminalId: TERMINAL, eventos: [evento(1), evento(2)] }

    const resultado = parsearSyncEmpujarSolicitud(solicitud)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato).toStrictEqual(solicitud)

    // Y lo que devuelve ya son eventos del libro: se aplican al dominio sin traducir.
    const eventos: Evento[] = resultado.dato.eventos
    expect(eventos.map((e) => e.secuencia)).toEqual([1, 2])
  })

  it('rechaza un tipo desconocido y el camino nombra el índice: eventos.0.tipo', () => {
    const resultado = parsearSyncEmpujarSolicitud({
      terminalId: TERMINAL,
      eventos: [evento(1, { tipo: 'tipo_inventado' })],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.code).toBe('validacion')
    expect(resultado.error.error.detalle.campo).toBe('eventos.0.tipo')
  })

  it('rechaza una schemaVersion futura en lugar de aplicarla en silencio', () => {
    const resultado = parsearSyncEmpujarSolicitud({
      terminalId: TERMINAL,
      eventos: [evento(1), evento(2, { schemaVersion: 2 })],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('eventos.1.schemaVersion')
    expect(resultado.error.error.mensaje).toContain('no soportada')
  })

  it('rechaza una solicitud que no trae eventos: no es un no-op, es un error del cliente', () => {
    const resultado = parsearSyncEmpujarSolicitud({ terminalId: TERMINAL, eventos: [] })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('eventos')
  })

  it('rechaza `eventos` que no es una lista y nombra el campo', () => {
    const resultado = parsearSyncEmpujarSolicitud({ terminalId: TERMINAL, eventos: evento(1) })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('eventos')
  })

  it('rechaza una solicitud sin terminalId: no hay forma de saber de qué terminal es la cola', () => {
    const resultado = parsearSyncEmpujarSolicitud({ eventos: [evento(1)] })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('terminalId')
  })
})

describe('syncEmpujarRespuesta', () => {
  it('parsea las cuatro listas y el acuse', () => {
    const respuesta = {
      aceptados: [{ id: 'evt-1', secuencia: 1 }],
      duplicados: [{ id: 'evt-2', secuencia: 2 }],
      conflictos: [{ id: 'evt-3', secuencia: 3, motivo: 'misma secuencia con otro cuerpo' }],
      rechazados: [{ id: 'evt-4', motivo: 'cantidad debe ser un entero positivo.' }],
      acuse: ACUSE,
    }

    const resultado = parsearSyncEmpujarRespuesta(respuesta)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato).toStrictEqual(respuesta)
  })

  it('acepta listas vacías: un empuje todo aceptado no tiene duplicados ni conflictos', () => {
    const resultado = parsearSyncEmpujarRespuesta({
      aceptados: [{ id: 'evt-1', secuencia: 1 }],
      duplicados: [],
      conflictos: [],
      rechazados: [],
      acuse: { terminalId: TERMINAL, ultimaSecuencia: 1 },
    })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.conflictos).toEqual([])
  })

  it('acepta un acuse en cero: una terminal que nunca recibió nada', () => {
    const resultado = parsearSyncEmpujarRespuesta({
      aceptados: [],
      duplicados: [],
      conflictos: [],
      rechazados: [],
      acuse: { terminalId: TERMINAL, ultimaSecuencia: 0 },
    })

    expect(resultado.ok).toBe(true)
  })

  it('rechaza una respuesta sin acuse y nombra el campo', () => {
    const resultado = parsearSyncEmpujarRespuesta({
      aceptados: [],
      duplicados: [],
      conflictos: [],
      rechazados: [],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('acuse')
  })
})

describe('syncTraerRespuesta', () => {
  it('hayMas ausente vale false', () => {
    const resultado = parsearSyncTraerRespuesta({ eventos: [], acuse: ACUSE })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.hayMas).toBe(false)
  })

  it('no coacciona hayMas desde un texto: `"true"` no es true', () => {
    const resultado = parsearSyncTraerRespuesta({ eventos: [], acuse: ACUSE, hayMas: 'true' })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('hayMas')
  })

  it('respeta un hayMas explícito', () => {
    const resultado = parsearSyncTraerRespuesta({ eventos: [], acuse: ACUSE, hayMas: true })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.hayMas).toBe(true)
  })

  it('parsea los eventos que trae y los deja como eventos del libro', () => {
    const respuesta = { eventos: [evento(4), evento(5)], acuse: ACUSE, hayMas: false }

    const resultado = parsearSyncTraerRespuesta(respuesta)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    const eventos: Evento[] = resultado.dato.eventos
    expect(eventos.map((e) => e.secuencia)).toEqual([4, 5])
  })
})

describe('syncTraerConsulta', () => {
  it('parsea terminalId y el cursor `desde`', () => {
    const consulta = { terminalId: TERMINAL, desde: '2026-11-22T10:00:00.000Z' }

    const resultado = parsearSyncTraerConsulta(consulta)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato).toStrictEqual(consulta)
  })

  it('exige `desde`: sin cursor no se puede paginar', () => {
    const resultado = parsearSyncTraerConsulta({ terminalId: TERMINAL })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('desde')
  })

  it('rechaza un `desde` que no es una fecha ISO-8601', () => {
    const resultado = parsearSyncTraerConsulta({ terminalId: TERMINAL, desde: 'ayer' })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.error.detalle.campo).toBe('desde')
  })
})
