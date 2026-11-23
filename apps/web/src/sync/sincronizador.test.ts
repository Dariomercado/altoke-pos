/**
 * El sincronizador (docs/specs/0001-arquitectura.md §I2, `0003` §Sync).
 *
 * Lo que se prueba, en términos de comportamiento:
 *   - empuja lo pendiente y avanza el acuse **sólo** con el acuse del servidor, nunca más allá de un
 *     hueco que el servidor no acusó,
 *   - un `huecos` del servidor reenvía exactamente esas secuencias y no inventa las que no tiene,
 *   - una falla transitoria se reintenta con backoff y termina bien (timers falsos, deterministas),
 *   - un evento traído que no valida no se escribe y no corta el resto de la página,
 *   - una falla definitiva o una caída de red deja el libro intacto y devuelve un estado, no lanza,
 *   - sin sesión no se llama a la red.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { crearStoreEnMemoria } from '@altoke/store'
import type { PosStore } from '@altoke/store'
import type { Evento } from '@altoke/domain'
import {
  TENANT_DE_PRUEBA,
  TERMINAL_AJENA,
  TERMINAL_DE_PRUEBA,
  acuseDe,
  acusesEnMemoria,
  eventoDePrueba,
  respuestaDeEmpuje,
  transporteDePrueba,
} from './dobles.ts'
import type { AcusesDePrueba, TransporteDePrueba } from './dobles.ts'
import {
  DESDE_EL_PRINCIPIO,
  crearSincronizador,
  esperaDeReintento,
} from './sincronizador.ts'
import type { OpcionesSincronizador, SesionDeSync } from './sincronizador.ts'

const SESION: SesionDeSync = { tenantId: TENANT_DE_PRUEBA, terminalId: TERMINAL_DE_PRUEBA }
const RED = { ok: false, error: { motivo: 'red', mensaje: 'sin red' } } as const

function armar(opciones: {
  readonly store: PosStore
  readonly transporte?: TransporteDePrueba
  readonly acuses?: AcusesDePrueba
  readonly sesion?: SesionDeSync | null
  readonly extras?: Partial<OpcionesSincronizador>
}): {
  sincronizador: ReturnType<typeof crearSincronizador>
  transporte: TransporteDePrueba
  acuses: AcusesDePrueba
} {
  const transporte = opciones.transporte ?? transporteDePrueba()
  const acuses = opciones.acuses ?? acusesEnMemoria()

  const sincronizador = crearSincronizador({
    store: opciones.store,
    transporte,
    acuses: acuses.acuses,
    sesion: opciones.sesion === undefined ? SESION : opciones.sesion,
    ...opciones.extras,
  })

  return { sincronizador, transporte, acuses }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sincronizar', () => {
  it('empuja lo pendiente y avanza el acuse con el del servidor', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])
    const { sincronizador, transporte, acuses } = armar({ store })

    const instantanea = await sincronizador.sincronizar()

    expect(transporte.empujes).toHaveLength(1)
    expect(transporte.empujes[0]?.eventos.map((evento) => evento.secuencia)).toEqual([1, 2])
    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBe(2)
    expect(instantanea.estado).toStrictEqual({ tipo: 'al_dia' })
    expect(instantanea.descartados).toBe(0)
  })

  it('la cola sale del libro y el acuse: con todo acusado no se vuelve a empujar nada', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])
    const { sincronizador, transporte } = armar({ store })

    await sincronizador.sincronizar()
    await sincronizador.sincronizar()

    expect(transporte.empujes).toHaveLength(1)
  })

  it('el acuse no avanza más allá de un hueco, aunque el libro tenga la secuencia de después', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2), eventoDePrueba(4)])
    const transporte = transporteDePrueba({
      empujar: () => ({
        ok: true,
        dato: respuestaDeEmpuje({
          acuse: 2,
          huecos: [3],
          aceptados: [eventoDePrueba(1), eventoDePrueba(2), eventoDePrueba(4)],
        }),
      }),
    })
    const { sincronizador, acuses } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBe(2)
    expect(instantanea.estado).toStrictEqual({ tipo: 'pendiente', pendientes: 1 })
    // No se inventa el 3: sólo se mandó lo que el libro tenía.
    expect(transporte.empujes.map((solicitud) => solicitud.eventos.map((e) => e.secuencia))).toEqual(
      [[1, 2, 4]],
    )
  })

  it('un huecos del servidor reenvía exactamente esas secuencias', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2), eventoDePrueba(3)])
    const transporte = transporteDePrueba({
      empujar: (_solicitud, numero) =>
        numero === 1
          ? { ok: true, dato: respuestaDeEmpuje({ acuse: 1, huecos: [2] }) }
          : { ok: true, dato: respuestaDeEmpuje({ acuse: 3 }) },
    })
    const { sincronizador, acuses } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    expect(transporte.empujes.map((solicitud) => solicitud.eventos.map((e) => e.secuencia))).toEqual(
      [[1, 2, 3], [2]],
    )
    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBe(3)
    expect(instantanea.estado).toStrictEqual({ tipo: 'al_dia' })
  })

  it('el acuse no avanza si el empuje falló, y el libro queda intacto', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])
    const transporte = transporteDePrueba({ empujar: () => RED })
    const { sincronizador, acuses } = armar({
      store,
      transporte,
      extras: { intentos: 2 },
    })

    const instantanea = await sincronizador.sincronizar()

    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBeUndefined()
    expect(instantanea.estado).toStrictEqual({ tipo: 'sin_red', pendientes: 2 })
    expect(transporte.empujes).toHaveLength(2)
    await expect(store.leerDesde(TERMINAL_DE_PRUEBA, 0)).resolves.toHaveLength(2)
  })

  it('una falla transitoria se reintenta con backoff y termina bien', async () => {
    vi.useFakeTimers()
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])
    const transporte = transporteDePrueba({
      empujar: (solicitud, numero) =>
        numero === 1
          ? RED
          : {
              ok: true,
              dato: respuestaDeEmpuje({ acuse: 2, aceptados: solicitud.eventos }),
            },
    })
    const { sincronizador, acuses } = armar({ store, transporte, extras: { aleatorio: () => 0 } })

    const corrida = sincronizador.sincronizar()
    await vi.advanceTimersByTimeAsync(5_000)
    const instantanea = await corrida

    expect(transporte.empujes).toHaveLength(2)
    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBe(2)
    expect(instantanea.estado).toStrictEqual({ tipo: 'al_dia' })
  })

  it('sin sesión no llama a la red y lo dice', async () => {
    const store = crearStoreEnMemoria()
    const { sincronizador, transporte } = armar({ store, sesion: null })

    const instantanea = await sincronizador.sincronizar()

    expect(instantanea.estado).toStrictEqual({ tipo: 'sin_sesion', motivo: 'no_autenticado' })
    expect(transporte.empujes).toHaveLength(0)
    expect(transporte.traidas).toHaveLength(0)
  })

  it('una sesión vencida es sin_sesion, no una excepción', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1)])
    const transporte = transporteDePrueba({
      empujar: () => ({ ok: false, error: { motivo: 'no_autenticado', mensaje: 'venció' } }),
    })
    const { sincronizador } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    expect(instantanea.estado).toStrictEqual({ tipo: 'sin_sesion', motivo: 'no_autenticado' })
    await expect(store.leerDesde(TERMINAL_DE_PRUEBA, 0)).resolves.toHaveLength(1)
  })

  it('sin permiso para empujar se informa como sin_sesion con su motivo', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1)])
    const transporte = transporteDePrueba({
      empujar: () => ({ ok: false, error: { motivo: 'sin_permiso', mensaje: 'sólo lectura' } }),
    })
    const { sincronizador } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    expect(instantanea.estado).toStrictEqual({ tipo: 'sin_sesion', motivo: 'sin_permiso' })
  })
})

describe('traer', () => {
  it('aplica los eventos de la otra terminal y proyecta la alerta de sobreventa', async () => {
    const store = crearStoreEnMemoria()
    const traido = eventoDePrueba(1, { delta: 5 }, TERMINAL_AJENA)
    const sobreventa = eventoDePrueba(
      1,
      {
        tipo: 'sobreventa_detectada',
        ventaId: 'venta-1',
        sku: 'alfajor',
        cantidad: 2,
        stockProyectado: -1,
      },
      'servidor',
    )
    const transporte = transporteDePrueba({
      traer: () => ({
        ok: true,
        dato: {
          eventos: [traido, sobreventa],
          acuse: acuseDe(TERMINAL_DE_PRUEBA, 0),
          hayMas: false,
          siguienteDesde: null,
        },
      }),
    })
    const { sincronizador } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    await expect(store.leerDesde(TERMINAL_AJENA, 0)).resolves.toEqual([traido])
    expect(instantanea.alertas).toMatchObject({
      'venta-1': { alfajor: { stockProyectado: -1, cantidad: 2 } },
    })
    expect(instantanea.estado).toStrictEqual({ tipo: 'al_dia' })
  })

  it('un evento inválido no se escribe y no corta el resto de la página', async () => {
    const store = crearStoreEnMemoria()
    const bueno = eventoDePrueba(1, {}, TERMINAL_AJENA)
    const roto = eventoDePrueba(2, { delta: 1.5 }, TERMINAL_AJENA) as unknown as Evento
    const tambienBueno = eventoDePrueba(3, {}, TERMINAL_AJENA)
    const transporte = transporteDePrueba({
      traer: () => ({
        ok: true,
        dato: {
          eventos: [bueno, roto, tambienBueno],
          acuse: acuseDe(TERMINAL_DE_PRUEBA, 0),
          hayMas: false,
          siguienteDesde: null,
        },
      }),
    })
    const { sincronizador } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    await expect(store.leerDesde(TERMINAL_AJENA, 0)).resolves.toEqual([bueno, tambienBueno])
    expect(instantanea.descartados).toBe(1)
  })

  it('un evento de otro tenant no entra al libro local', async () => {
    const store = crearStoreEnMemoria()
    const ajeno = { ...eventoDePrueba(1, {}, TERMINAL_AJENA), tenantId: 'otro-tenant' } as Evento
    const transporte = transporteDePrueba({
      traer: () => ({
        ok: true,
        dato: {
          eventos: [ajeno],
          acuse: acuseDe(TERMINAL_DE_PRUEBA, 0),
          hayMas: false,
          siguienteDesde: null,
        },
      }),
    })
    const { sincronizador } = armar({ store, transporte })

    const instantanea = await sincronizador.sincronizar()

    await expect(store.leerDesde(TERMINAL_AJENA, 0)).resolves.toEqual([])
    expect(instantanea.descartados).toBe(1)
  })

  it('pagina con siguienteDesde hasta que hayMas es false', async () => {
    const store = crearStoreEnMemoria()
    const primera = eventoDePrueba(1, {}, TERMINAL_AJENA)
    const segunda = eventoDePrueba(2, {}, TERMINAL_AJENA)
    const transporte = transporteDePrueba({
      traer: (_consulta, numero) =>
        numero === 1
          ? {
              ok: true,
              dato: {
                eventos: [primera],
                acuse: acuseDe(TERMINAL_DE_PRUEBA, 0),
                hayMas: true,
                siguienteDesde: '2026-11-23T03:00:00.000Z',
              },
            }
          : {
              ok: true,
              dato: {
                eventos: [segunda],
                acuse: acuseDe(TERMINAL_DE_PRUEBA, 0),
                hayMas: false,
                siguienteDesde: null,
              },
            },
    })
    const { sincronizador } = armar({ store, transporte })

    await sincronizador.sincronizar()

    expect(transporte.traidas.map((consulta) => consulta.desde)).toEqual([
      DESDE_EL_PRINCIPIO,
      '2026-11-23T03:00:00.000Z',
    ])
    await expect(store.leerDesde(TERMINAL_AJENA, 0)).resolves.toEqual([primera, segunda])
  })

  it('si la traída falla después de empujar, el acuse ya avanzado se conserva', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1)])
    const transporte = transporteDePrueba({ traer: () => RED })
    const { sincronizador, acuses } = armar({
      store,
      transporte,
      extras: { intentos: 1 },
    })

    const instantanea = await sincronizador.sincronizar()

    expect(acuses.valores.get(TERMINAL_DE_PRUEBA)).toBe(1)
    expect(instantanea.estado).toStrictEqual({ tipo: 'sin_red', pendientes: 0 })
  })
})

describe('refrescar', () => {
  it('cuenta los pendientes y las alertas sin tocar la red', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])
    const { sincronizador, transporte } = armar({ store })

    const instantanea = await sincronizador.refrescar()

    expect(instantanea.estado).toStrictEqual({ tipo: 'pendiente', pendientes: 2 })
    expect(instantanea.alertas).toEqual({})
    expect(transporte.empujes).toHaveLength(0)
    expect(transporte.traidas).toHaveLength(0)
  })

  it('notifica a los suscriptores y se puede desuscribir', async () => {
    const store = crearStoreEnMemoria()
    const { sincronizador } = armar({ store })
    const vistas: string[] = []
    const desuscribir = sincronizador.suscribir((instantanea) => vistas.push(instantanea.estado.tipo))

    await sincronizador.refrescar()
    desuscribir()
    await sincronizador.refrescar()

    expect(vistas).toEqual(['al_dia'])
  })

  it('nunca lanza aunque el store falle: devuelve un estado', async () => {
    const store: PosStore = {
      append: async () => {},
      leerDesde: async () => {
        throw new Error('IndexedDB bloqueada')
      },
      proyectar: async () => {
        throw new Error('IndexedDB bloqueada')
      },
      limpiar: async () => {},
    }
    const { sincronizador } = armar({ store })

    await expect(sincronizador.sincronizar()).resolves.toMatchObject({
      estado: expect.objectContaining({ tipo: expect.any(String) }),
    })
  })
})

describe('esperaDeReintento', () => {
  it('crece exponencialmente, tiene techo y suma jitter acotado', () => {
    const sinJitter = (intento: number): number =>
      esperaDeReintento(intento, { baseMs: 250, maximoMs: 8_000, aleatorio: () => 0 })

    expect([0, 1, 2, 3].map(sinJitter)).toEqual([250, 500, 1_000, 2_000])
    expect(sinJitter(10)).toBe(8_000)

    const conJitterMaximo = esperaDeReintento(0, {
      baseMs: 250,
      maximoMs: 8_000,
      aleatorio: () => 1,
    })
    expect(conJitterMaximo).toBe(375)
    expect(conJitterMaximo).toBeLessThanOrEqual(375)
  })
})
