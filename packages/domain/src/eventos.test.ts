import { describe, expect, it } from 'vitest'
import {
  MEDIOS_PAGO,
  TERMINAL_DEL_SERVIDOR,
  leerDesde,
  proyeccionSobreventas,
  proyeccionStock,
  proyeccionTurno,
  proyectar,
  resumirTurno,
  validarEvento,
  validarEventoDeCliente,
} from './eventos'
import type { Evento } from './eventos'

const TENANT = 'kiosco-1'
const TERMINAL = 'term-1'
const OTRA_TERMINAL = 'term-2'

let id = 0

/** Envoltorio mínimo; cada test pasa la secuencia explícita para controlar el orden. */
function evento(secuencia: number, resto: object, terminalId: string = TERMINAL): Evento {
  return {
    id: `evt-${++id}`,
    tenantId: TENANT,
    terminalId,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    ...resto,
  } as Evento
}

describe('leerDesde — cola de eventos de una terminal', () => {
  it('devuelve sólo la terminal pedida y sólo lo posterior a la secuencia acusada', () => {
    const stream = [
      evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'inicial' }),
      evento(2, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }, OTRA_TERMINAL),
      evento(3, { tipo: 'ajuste_stock', sku: 'b', delta: 1, causa: 'compra' }),
    ]

    const nuevos = leerDesde(stream, TERMINAL, 1)

    expect(nuevos.map((e) => e.secuencia)).toEqual([3])
  })

  it('ordena por secuencia aunque la entrada venga desordenada', () => {
    const desordenado = [
      evento(5, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }),
      evento(3, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }),
      evento(4, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }),
    ]

    expect(leerDesde(desordenado, TERMINAL, 0).map((e) => e.secuencia)).toEqual([3, 4, 5])
  })

  it('con la secuencia al día devuelve vacío', () => {
    const stream = [evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' })]

    expect(leerDesde(stream, TERMINAL, 1)).toEqual([])
  })

  it('no toca el arreglo de entrada', () => {
    const desordenado = [
      evento(2, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }),
      evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'compra' }),
    ]
    const copia = [...desordenado]

    leerDesde(desordenado, TERMINAL, 0)

    expect(desordenado).toEqual(copia)
  })
})

describe('proyectar — un reductor puro sobre el libro', () => {
  it('sin eventos devuelve el estado inicial', () => {
    const stock = proyectar([], proyeccionStock())

    expect(stock).toEqual({})
  })

  it('aplica en el orden recibido', () => {
    const stream = [
      evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 10, causa: 'inicial' }),
      evento(2, { tipo: 'ajuste_stock', sku: 'a', delta: -3, causa: 'merma' }),
    ]

    expect(proyectar(stream, proyeccionStock())).toEqual({ a: 7 })
  })

  it('no muta los eventos ni el estado previo', () => {
    const stream = Object.freeze([
      evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 10, causa: 'inicial' }),
    ])
    const inicial = proyeccionStock().inicial

    const resultado = proyectar(stream, proyeccionStock())

    expect(inicial).toEqual({})
    expect(resultado).not.toBe(inicial)
  })
})

describe('proyeccionStock — el stock es una proyección, no una fila mutable', () => {
  it('descuenta lo vendido, repone lo quitado y lo devuelto, y suma los ajustes', () => {
    const stream = [
      evento(1, { tipo: 'ajuste_stock', sku: 'alfajor', delta: 10, causa: 'inicial' }),
      evento(2, { tipo: 'item_agregado', ventaId: 'v1', sku: 'alfajor', cantidad: 2, precioUnitarioCentavos: 1000 }),
      evento(3, { tipo: 'item_quitado', ventaId: 'v1', sku: 'alfajor', cantidad: 1 }),
      evento(4, { tipo: 'item_devuelto', ventaId: 'v1', sku: 'alfajor', cantidad: 1, motivo: 'vencido' }),
    ]

    // 10 − 2 + 1 + 1
    expect(proyectar(stream, proyeccionStock())).toEqual({ alfajor: 10 })
  })

  it('permite stock negativo: el kiosco ya vende el último alfajor sin saberlo', () => {
    const stream = [
      evento(1, {
        tipo: 'item_agregado',
        ventaId: 'v1',
        sku: 'alfajor',
        cantidad: 1,
        precioUnitarioCentavos: 1000,
      }),
    ]

    expect(proyectar(stream, proyeccionStock())).toEqual({ alfajor: -1 })
  })
})

describe('proyeccionTurno — la caja del turno', () => {
  const abrir = evento(1, { tipo: 'turno_abierto', turnoId: 'turno-1', fondoCentavos: 5000 })

  it('arranca con el fondo y sin ventas', () => {
    const resumen = resumirTurno(proyectar([abrir], proyeccionTurno()))

    expect(resumen).toMatchObject({
      turnoId: 'turno-1',
      abierto: true,
      fondoCentavos: 5000,
      ventasConfirmadas: 0,
      ventasAnuladas: 0,
      totalCentavos: 0,
      cobradoCentavos: 0,
    })
    expect(resumen.cobradoPorMedio).toEqual({ efectivo: 0, tarjeta_manual: 0, transferencia: 0, qr: 0 })
  })

  it('suma las ventas confirmadas y lo cobrado por medio', () => {
    const stream = [
      abrir,
      evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
      evento(3, { tipo: 'item_agregado', ventaId: 'v1', sku: 'alfajor', cantidad: 2, precioUnitarioCentavos: 1000 }),
      evento(4, { tipo: 'pago_registrado', ventaId: 'v1', medio: 'efectivo', montoCentavos: 2000 }),
      evento(5, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 2000 }),
      evento(6, { tipo: 'venta_iniciada', ventaId: 'v2', turnoId: 'turno-1' }),
      evento(7, { tipo: 'pago_registrado', ventaId: 'v2', medio: 'efectivo', montoCentavos: 500 }),
      evento(8, { tipo: 'pago_registrado', ventaId: 'v2', medio: 'qr', montoCentavos: 1500 }),
      evento(9, { tipo: 'venta_confirmada', ventaId: 'v2', totalCentavos: 2000 }),
    ]

    const resumen = resumirTurno(proyectar(stream, proyeccionTurno()))

    expect(resumen.totalCentavos).toBe(4000)
    expect(resumen.cobradoCentavos).toBe(4000)
    expect(resumen.diferenciaCentavos).toBe(0)
    expect(resumen.ventasConfirmadas).toBe(2)
    expect(resumen.cobradoPorMedio).toEqual({
      efectivo: 2500,
      tarjeta_manual: 0,
      transferencia: 0,
      qr: 1500,
    })
  })

  it('una venta anulada no suma al total ni a lo cobrado', () => {
    const stream = [
      abrir,
      evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
      evento(3, { tipo: 'pago_registrado', ventaId: 'v1', medio: 'efectivo', montoCentavos: 2000 }),
      evento(4, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 2000 }),
      evento(5, { tipo: 'venta_anulada', ventaId: 'v1', motivo: 'cobro mal tipeado' }),
    ]

    const resumen = resumirTurno(proyectar(stream, proyeccionTurno()))

    expect(resumen).toMatchObject({
      ventasConfirmadas: 0,
      ventasAnuladas: 1,
      totalCentavos: 0,
      cobradoCentavos: 0,
      diferenciaCentavos: 0,
    })
  })

  it('deja ver la diferencia cuando la venta se confirma sin cobrar', () => {
    const stream = [
      abrir,
      evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
      evento(3, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 2000 }),
    ]

    expect(resumirTurno(proyectar(stream, proyeccionTurno())).diferenciaCentavos).toBe(-2000)
  })

  it('el total es el que se confirmó, con el descuento ya aplicado', () => {
    const stream = [
      abrir,
      evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
      evento(3, { tipo: 'item_agregado', ventaId: 'v1', sku: 'alfajor', cantidad: 2, precioUnitarioCentavos: 1000 }),
      evento(4, { tipo: 'descuento', ventaId: 'v1', montoCentavos: 200, motivo: 'cliente frecuente' }),
      evento(5, { tipo: 'pago_registrado', ventaId: 'v1', medio: 'efectivo', montoCentavos: 1800 }),
      evento(6, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 1800 }),
    ]

    const resumen = resumirTurno(proyectar(stream, proyeccionTurno()))

    expect(resumen.totalCentavos).toBe(1800)
    expect(resumen.diferenciaCentavos).toBe(0)
  })

  it('cuenta unidades por SKU y las repone cuando se quitan ítems', () => {
    const stream = [
      abrir,
      evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
      evento(3, { tipo: 'item_agregado', ventaId: 'v1', sku: 'alfajor', cantidad: 3, precioUnitarioCentavos: 1000 }),
      evento(4, { tipo: 'item_agregado', ventaId: 'v1', sku: 'agua', cantidad: 1, precioUnitarioCentavos: 1500 }),
      evento(5, { tipo: 'item_quitado', ventaId: 'v1', sku: 'alfajor', cantidad: 1 }),
      evento(6, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 3500 }),
    ]

    expect(resumirTurno(proyectar(stream, proyeccionTurno())).unidadesPorSku).toEqual({
      alfajor: 2,
      agua: 1,
    })
  })

  it('el cierre deja el turno cerrado con lo declarado', () => {
    const stream = [abrir, evento(2, { tipo: 'turno_cerrado', turnoId: 'turno-1', declaradoCentavos: 6200 })]

    expect(resumirTurno(proyectar(stream, proyeccionTurno()))).toMatchObject({
      abierto: false,
      declaradoCentavos: 6200,
    })
  })
})

describe('validarEvento — el borde no persiste basura', () => {
  const valido = evento(1, { tipo: 'item_agregado', ventaId: 'v1', sku: 'alfajor', cantidad: 2, precioUnitarioCentavos: 1000 })

  it('acepta un evento bien formado', () => {
    expect(() => validarEvento(valido)).not.toThrow()
  })

  it('acepta cada tipo del libro', () => {
    const todos: Evento[] = [
      evento(2, { tipo: 'turno_abierto', turnoId: 't', fondoCentavos: 0 }),
      evento(3, { tipo: 'venta_iniciada', ventaId: 'v', turnoId: 't' }),
      evento(4, { tipo: 'item_quitado', ventaId: 'v', sku: 'a', cantidad: 1 }),
      evento(5, { tipo: 'item_devuelto', ventaId: 'v', sku: 'a', cantidad: 1, motivo: 'roto' }),
      evento(6, { tipo: 'descuento', ventaId: 'v', montoCentavos: 100, motivo: 'promo' }),
      evento(7, { tipo: 'pago_registrado', ventaId: 'v', medio: 'transferencia', montoCentavos: 500 }),
      evento(8, { tipo: 'venta_confirmada', ventaId: 'v', totalCentavos: 500 }),
      evento(9, { tipo: 'venta_anulada', ventaId: 'v', motivo: 'error' }),
      evento(10, { tipo: 'ajuste_stock', sku: 'a', delta: -2, causa: 'merma' }),
      evento(11, { tipo: 'turno_cerrado', turnoId: 't', declaradoCentavos: 500 }),
      sobreventa(12),
    ]

    for (const candidato of todos) {
      expect(() => validarEvento(candidato), candidato.tipo).not.toThrow()
    }
  })

  it('rechaza una secuencia que no es entero positivo', () => {
    expect(() => validarEvento({ ...valido, secuencia: 0 })).toThrow(RangeError)
    expect(() => validarEvento({ ...valido, secuencia: 1.5 })).toThrow(RangeError)
  })

  it('rechaza importes con centavos fraccionarios', () => {
    expect(() =>
      validarEvento({ ...valido, precioUnitarioCentavos: 10.5 } as Evento),
    ).toThrow(RangeError)
  })

  it('rechaza cantidades no positivas', () => {
    expect(() => validarEvento({ ...valido, cantidad: 0 } as Evento)).toThrow(RangeError)
    expect(() => validarEvento({ ...valido, cantidad: -1 } as Evento)).toThrow(RangeError)
  })

  it('rechaza un medio de pago desconocido', () => {
    expect(() =>
      validarEvento({
        ...evento(1, { tipo: 'pago_registrado', ventaId: 'v', medio: 'bitcoin', montoCentavos: 100 }),
      } as Evento),
    ).toThrow(RangeError)
  })

  it('rechaza el envoltorio incompleto o de otra versión', () => {
    expect(() => validarEvento({ ...valido, id: '' })).toThrow(TypeError)
    expect(() => validarEvento({ ...valido, tenantId: '' })).toThrow(TypeError)
    expect(() => validarEvento({ ...valido, ocurridoEn: 'ayer' })).toThrow(TypeError)
    expect(() => validarEvento({ ...valido, schemaVersion: 2 } as unknown as Evento)).toThrow(RangeError)
  })

  it('rechaza un tipo de evento que el libro no conoce', () => {
    expect(() => validarEvento({ ...valido, tipo: 'venta_telepática' } as unknown as Evento)).toThrow(
      RangeError,
    )
  })

  it('valida todos los medios de pago declarados', () => {
    for (const medio of MEDIOS_PAGO) {
      expect(medio).toMatch(/^(efectivo|tarjeta_manual|transferencia|qr)$/)
    }
  })
})

/**
 * Un `sobreventa_detectada` bien formado: lo escribe el servidor en su terminal reservada.
 *
 * `0001` §3: dos terminales venden la última unidad, las dos ventas valen, el stock queda
 * negativo y el libro lo dice con este evento. La UI lo muestra como alerta.
 */
function sobreventa(secuencia: number, extra: object = {}): Evento {
  return evento(
    secuencia,
    {
      tipo: 'sobreventa_detectada',
      ventaId: 'venta-2',
      sku: 'alfajor',
      cantidad: 1,
      stockProyectado: -1,
      ...extra,
    },
    TERMINAL_DEL_SERVIDOR,
  )
}

describe('sobreventa_detectada — la última unidad vendida dos veces', () => {
  it('es informativa: no mueve el stock ni cambia el turno', () => {
    const libro = [
      evento(1, { tipo: 'turno_abierto', turnoId: 'turno-1', fondoCentavos: 0 }),
      evento(2, { tipo: 'venta_iniciada', ventaId: 'venta-1', turnoId: 'turno-1' }),
      evento(3, {
        tipo: 'item_agregado',
        ventaId: 'venta-1',
        sku: 'alfajor',
        cantidad: 2,
        precioUnitarioCentavos: 1000,
      }),
      evento(4, { tipo: 'venta_confirmada', ventaId: 'venta-1', totalCentavos: 2000 }),
    ]

    const sinSobreventa = {
      stock: proyectar(libro, proyeccionStock()),
      turno: resumirTurno(proyectar(libro, proyeccionTurno())),
    }
    const conSobreventa = {
      stock: proyectar([...libro, sobreventa(5)], proyeccionStock()),
      turno: resumirTurno(proyectar([...libro, sobreventa(5)], proyeccionTurno())),
    }

    // El stock ya era negativo sin el evento: el evento cuenta el hecho, no lo produce.
    expect(conSobreventa).toStrictEqual(sinSobreventa)
    expect(conSobreventa.stock).toEqual({ alfajor: -2 })
  })

  it('aplicarla dos veces no cambia la proyección: el mismo hecho no es dos hechos', () => {
    const proyeccion = proyeccionSobreventas()
    const hecho = sobreventa(1)

    const una = proyeccion.aplicar(proyeccion.inicial, hecho)
    const dos = proyeccion.aplicar(una, hecho)

    expect(dos).toBe(una)
    expect(proyectar([hecho, hecho], proyeccionSobreventas())).toStrictEqual(
      proyectar([hecho], proyeccionSobreventas()),
    )
  })

  it('agrupa las alertas por venta y sku: dos hechos son dos entradas', () => {
    const otra = sobreventa(2, { sku: 'agua', cantidad: 2, stockProyectado: -2 })

    expect(
      proyectar([sobreventa(1), otra], proyeccionSobreventas()),
      'la proyección de alertas es la que el POS muestra como sobreventa',
    ).toStrictEqual({
      'venta-2': {
        alfajor: { ventaId: 'venta-2', sku: 'alfajor', cantidad: 1, stockProyectado: -1 },
        agua: { ventaId: 'venta-2', sku: 'agua', cantidad: 2, stockProyectado: -2 },
      },
    })
  })

  it('validarEvento la acepta y exige un stock proyectado negativo y entero', () => {
    expect(() => validarEvento(sobreventa(1))).not.toThrow()
    expect(() => validarEvento(sobreventa(1, { stockProyectado: 0 }))).toThrow(RangeError)
    expect(() => validarEvento(sobreventa(1, { stockProyectado: 1 }))).toThrow(RangeError)
    expect(() => validarEvento(sobreventa(1, { stockProyectado: -1.5 }))).toThrow(RangeError)
    expect(() => validarEvento(sobreventa(1, { cantidad: 0 }))).toThrow(RangeError)
    expect(() => validarEvento(sobreventa(1, { ventaId: '' }))).toThrow(TypeError)
  })
})

describe('validarEventoDeCliente — la caja no escribe lo que sólo el servidor presencia', () => {
  it('acepta los eventos que la caja sí escribe', () => {
    expect(() =>
      validarEventoDeCliente(
        evento(1, { tipo: 'ajuste_stock', sku: 'alfajor', delta: 1, causa: 'compra' }),
      ),
    ).not.toThrow()
  })

  it('rechaza `sobreventa_detectada` aunque `validarEvento` la acepte', () => {
    // El servidor la escribe; una terminal que la empuja estaría inventando un hecho que no
    // presenció. Acá la terminal es la propia de la caja: lo que se rechaza es el tipo.
    const comoCaja = { ...sobreventa(1), terminalId: TERMINAL }

    expect(() => validarEvento(comoCaja)).not.toThrow()
    expect(() => validarEventoDeCliente(comoCaja)).toThrow(/sobreventa_detectada/)
  })

  it('rechaza escribir con la terminal reservada del servidor', () => {
    const comoServidor = { ...evento(1, { tipo: 'ajuste_stock', sku: 'a', delta: 1, causa: 'x' }), terminalId: TERMINAL_DEL_SERVIDOR }

    expect(() => validarEventoDeCliente(comoServidor)).toThrow(/servidor/)
  })
})
