import { describe, expect, it, vi } from 'vitest'
import type { EmisionFiscal, Evento, ModoFiscal } from '@altoke/domain'
import { crearStoreEnMemoria } from '@altoke/store'
import { ALICUOTA_KIOSCO } from './venta'
import type { LineaDeVenta } from './venta'
import { crearCaja } from './caja'
import type { Caja, OutboxFiscal } from './caja'

const TENANT = 'kiosco-1'
const TERMINAL = 'term-1'

function alfajor(cantidad = 1): LineaDeVenta {
  return {
    sku: 'alfajor',
    nombre: 'Alfajor',
    cantidad,
    precioUnitarioCentavos: 1210,
    alicuotaBps: ALICUOTA_KIOSCO,
  }
}

async function cajaDePrueba(opciones: OpcionesDePrueba = {}): Promise<{
  caja: Caja
  libro: () => Promise<Evento[]>
}> {
  const store = crearStoreEnMemoria()
  let n = 0

  const caja = crearCaja({
    store,
    tenantId: TENANT,
    terminalId: TERMINAL,
    ahora: () => '2026-11-22T10:00:00.000Z',
    nuevoId: () => `id-${++n}`,
    ...opciones,
  })

  return { caja, libro: () => store.leerDesde(TERMINAL, 0) }
}

interface OpcionesDePrueba {
  /** `tenants.modo_fiscal`: por defecto el de M2, F0 (`ninguno`). */
  readonly modoFiscal?: ModoFiscal
  readonly outbox?: OutboxFiscal
}

describe('caja — abrir y cobrar', () => {
  it('no cobra sin turno abierto y no escribe nada', async () => {
    const { caja, libro } = await cajaDePrueba()

    await expect(
      caja.cobrar([alfajor()], [{ medio: 'efectivo', montoCentavos: 1210 }]),
    ).rejects.toThrow(/turno abierto/i)

    await expect(libro()).resolves.toEqual([])
  })

  it('no abre dos turnos a la vez', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(5000)

    await expect(caja.abrirTurno(1000)).rejects.toThrow(/turno abierto/i)
  })

  it('cobra en efectivo, calcula el cambio y deja la venta en el turno', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(5000)

    const venta = await caja.cobrar([alfajor(2)], [{ medio: 'efectivo', montoCentavos: 5000 }])

    expect(venta).toMatchObject({
      totalCentavos: 2420,
      ivaCentavos: 420,
      netoCentavos: 2000,
      cambioCentavos: 2580,
    })

    const estado = await caja.estado()
    expect(estado.turno).toMatchObject({
      abierto: true,
      fondoCentavos: 5000,
      ventasConfirmadas: 1,
      totalCentavos: 2420,
      cobradoCentavos: 5000,
    })
    expect(estado.turno.cobradoPorMedio.efectivo).toBe(5000)
    // El cambio salió del cajón: lo que queda es el total de la venta.
    expect(estado.turno.cobradoCentavos - venta.cambioCentavos).toBe(2420)
  })

  it('una venta mal cobrada no se confirma ni descuenta stock', async () => {
    const { caja } = await cajaDePrueba()
    await caja.sembrar({ alfajor: 10 })
    await caja.abrirTurno(5000)

    await expect(
      caja.cobrar([alfajor(2)], [{ medio: 'efectivo', montoCentavos: 2000 }]),
    ).rejects.toThrow(RangeError)

    const estado = await caja.estado()
    expect(estado.turno.ventasConfirmadas).toBe(0)
    expect(estado.stock).toEqual({ alfajor: 10 })
  })

  it('acepta pago mixto y no da vuelto sobre la tarjeta', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(0)

    const venta = await caja.cobrar(
      [alfajor(2)],
      [
        { medio: 'tarjeta_manual', montoCentavos: 2000 },
        { medio: 'efectivo', montoCentavos: 420 },
      ],
    )

    expect(venta.cambioCentavos).toBe(0)
    const { turno } = await caja.estado()
    expect(turno.cobradoPorMedio).toMatchObject({ tarjeta_manual: 2000, efectivo: 420 })
  })

  it('descuenta el stock vendido', async () => {
    const { caja } = await cajaDePrueba()
    await caja.sembrar({ alfajor: 10, agua: 5 })
    await caja.abrirTurno(0)

    await caja.cobrar([alfajor(3)], [{ medio: 'efectivo', montoCentavos: 3630 }])

    expect((await caja.estado()).stock).toEqual({ alfajor: 7, agua: 5 })
  })

  it('dos ventas seguidas dejan secuencias estrictamente crecientes', async () => {
    const { caja, libro } = await cajaDePrueba()
    await caja.abrirTurno(1000)
    await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])
    await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    const secuencias = (await libro()).map((evento) => evento.secuencia)

    expect(secuencias).toEqual([...secuencias].sort((a, b) => a - b))
    expect(new Set(secuencias).size).toBe(secuencias.length)
  })

  it('los eventos que escribe llevan el envoltorio completo', async () => {
    const { caja, libro } = await cajaDePrueba()
    await caja.abrirTurno(1000)
    await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    const eventos = await libro()

    expect(eventos.map((evento) => evento.tipo)).toEqual([
      'turno_abierto',
      'venta_iniciada',
      'item_agregado',
      'pago_registrado',
      'venta_confirmada',
    ])
    for (const evento of eventos) {
      expect(evento.tenantId).toBe(TENANT)
      expect(evento.terminalId).toBe(TERMINAL)
      expect(evento.schemaVersion).toBe(1)
      expect(evento.ocurridoEn).toBe('2026-11-22T10:00:00.000Z')
      expect(evento.id).toMatch(/^id-\d+$/)
    }
  })
})

describe('caja — anular y cerrar', () => {
  it('anular saca la venta del total del turno', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(0)
    const venta = await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    await caja.anular(venta.ventaId, 'cobro mal tipeado')

    const { turno } = await caja.estado()
    expect(turno).toMatchObject({ ventasConfirmadas: 0, ventasAnuladas: 1, totalCentavos: 0 })
  })

  it('anular exige motivo y una venta confirmada del turno', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(0)
    const venta = await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    await expect(caja.anular(venta.ventaId, '  ')).rejects.toThrow(/motivo/i)
    await expect(caja.anular('no-existe', 'error')).rejects.toThrow(/no está en el turno/i)
  })

  it('cerrar compara el cajón contra el libro y deja el turno cerrado', async () => {
    const { caja } = await cajaDePrueba()
    await caja.abrirTurno(5000)
    await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    // Esperado 6210 centavos: fondo 5000 + 1210 cobrados. Contado igual: $20×3 + $2 + $0,10.
    const cierre = await caja.cerrarTurno({ 2_000: 3, 200: 1, 10: 1 })

    expect(cierre.arqueo).toEqual({
      esperadoCentavos: 6210,
      contadoCentavos: 6210,
      diferenciaCentavos: 0,
      estado: 'cuadrado',
    })
    expect((await caja.estado()).turno.abierto).toBe(false)
  })

  it('no cierra sin turno abierto', async () => {
    const { caja } = await cajaDePrueba()

    await expect(caja.cerrarTurno({})).rejects.toThrow(/turno abierto/i)
  })
})

describe('caja — inventario inicial', () => {
  it('siembra una sola vez, aunque se llame dos veces', async () => {
    const { caja } = await cajaDePrueba()

    await expect(caja.sembrar({ alfajor: 10 })).resolves.toBe(true)
    await expect(caja.sembrar({ alfajor: 10 })).resolves.toBe(false)
    expect((await caja.estado()).stock).toEqual({ alfajor: 10 })
  })

  it('el stock inicial queda en el libro como evento, no como fila', async () => {
    const { caja, libro } = await cajaDePrueba()

    await caja.sembrar({ alfajor: 10, agua: 5 })

    const eventos = await libro()
    expect(eventos.map((evento) => evento.tipo)).toEqual(['ajuste_stock', 'ajuste_stock'])
    expect(eventos).toEqual([
      expect.objectContaining({ sku: 'alfajor', delta: 10, causa: 'inicial' }),
      expect.objectContaining({ sku: 'agua', delta: 5, causa: 'inicial' }),
    ])
    expect((await caja.estado()).stock).toEqual({ alfajor: 10, agua: 5 })
  })
})

/**
 * El outbox fiscal (0002 §3, 0003 §Outbox fiscal): en M2 el camino existe y está **apagado**.
 *
 * Lo que estos tests defienden, en orden de importancia:
 *
 *   1. **Nunca se pierde una venta por un problema fiscal.** Con el outbox caído —síncrono o
 *      rechazando— la venta se escribe y el turno suma igual. El cobro no lo espera.
 *   2. **En F0 no se encola nada.** El tenant `ninguno` no emite comprobante, así que el outbox de
 *      M2 queda vacío aunque el camino esté escrito.
 *   3. **El camino está de verdad conectado**, no comentado: en un modo que emite, el cobro deja
 *      una emisión `pendiente` de esa venta, y la deja *después* de escribir la venta.
 *
 * El tercero es el que obliga a que el seam exista; el primero es el que decide cómo se llama.
 */
describe('caja — outbox fiscal', () => {
  it('en F0 el cobro confirmado no encola nada y la venta se escribe igual que siempre', async () => {
    const outbox: OutboxFiscal = { encolar: vi.fn(async () => {}) }
    const { caja, libro } = await cajaDePrueba({ modoFiscal: 'ninguno', outbox })

    await caja.abrirTurno(5000)
    const venta = await caja.cobrar([alfajor(2)], [{ medio: 'efectivo', montoCentavos: 5000 }])

    await new Promise((resolver) => setTimeout(resolver, 0))

    expect(outbox.encolar).not.toHaveBeenCalled()

    // El camino de la venta no cambió: los mismos eventos, el mismo total, el mismo vuelto.
    expect(venta).toMatchObject({ totalCentavos: 2420, cambioCentavos: 2580 })
    expect((await libro()).map((evento) => evento.tipo)).toEqual([
      'turno_abierto',
      'venta_iniciada',
      'item_agregado',
      'pago_registrado',
      'venta_confirmada',
    ])
    expect((await caja.estado()).turno).toMatchObject({
      abierto: true,
      ventasConfirmadas: 1,
      totalCentavos: 2420,
      cobradoCentavos: 5000,
    })
  })

  it('el cobro se escribe aunque el outbox tire: la venta no se pierde', async () => {
    const outbox: OutboxFiscal = {
      encolar: vi.fn(() => {
        throw new Error('el emisor fiscal no responde')
      }),
    }
    const { caja, libro } = await cajaDePrueba({ modoFiscal: 'controlador_fiscal', outbox })

    await caja.abrirTurno(0)
    const venta = await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    expect(venta.totalCentavos).toBe(1210)
    expect(outbox.encolar).toHaveBeenCalledTimes(1)
    expect((await libro()).filter((evento) => evento.tipo === 'venta_confirmada')).toHaveLength(1)
    expect((await caja.estado()).turno).toMatchObject({
      ventasConfirmadas: 1,
      totalCentavos: 1210,
      cobradoCentavos: 1210,
    })
  })

  it('tampoco se pierde si el outbox rechaza: el cobro no lo espera', async () => {
    const outbox: OutboxFiscal = {
      encolar: vi.fn(async () => {
        throw new Error('sin red')
      }),
    }
    const { caja, libro } = await cajaDePrueba({ modoFiscal: 'factura_electronica', outbox })

    await caja.abrirTurno(0)
    await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    // El rechazo se descarta en el propio cobro: si quedara suelto, este `await` lo haría visible
    // como unhandled y la suite fallaría por una venta que se cobró bien.
    await new Promise((resolver) => setTimeout(resolver, 0))

    expect((await libro()).filter((evento) => evento.tipo === 'venta_confirmada')).toHaveLength(1)
    expect((await caja.estado()).turno.totalCentavos).toBe(1210)
  })

  it('en un modo que emite, encola una emisión pendiente después de escribir la venta', async () => {
    const store = crearStoreEnMemoria()
    let n = 0
    const encoladas: EmisionFiscal[] = []
    const libroAlEncolar: string[][] = []

    const outbox: OutboxFiscal = {
      async encolar(emision: EmisionFiscal): Promise<void> {
        encoladas.push(emision)
        libroAlEncolar.push((await store.leerDesde(TERMINAL, 0)).map((evento) => evento.tipo))
      },
    }

    const caja = crearCaja({
      store,
      tenantId: TENANT,
      terminalId: TERMINAL,
      ahora: () => '2026-11-22T10:00:00.000Z',
      nuevoId: () => `id-${++n}`,
      modoFiscal: 'controlador_fiscal',
      outbox,
    })

    await caja.abrirTurno(0)
    const venta = await caja.cobrar([alfajor(1)], [{ medio: 'efectivo', montoCentavos: 1210 }])

    // El cobro no espera al outbox: lo que encoló se mira un tick después, no en el `cobrar`.
    await new Promise((resolver) => setTimeout(resolver, 0))

    expect(encoladas).toEqual([
      expect.objectContaining({
        tenantId: TENANT,
        ventaId: venta.ventaId,
        estado: 'pendiente',
        intentos: 0,
        motivo: null,
        creadoEn: '2026-11-22T10:00:00.000Z',
      }),
    ])
    // El orden importa: cuando la emisión se encola, la venta ya está en el libro.
    expect(libroAlEncolar).toEqual([
      ['turno_abierto', 'venta_iniciada', 'item_agregado', 'pago_registrado', 'venta_confirmada'],
    ])
  })
})
