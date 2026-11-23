/**
 * Suite única de contrato del puerto `PosStore` (docs/specs/0001-arquitectura.md §4).
 *
 * Un adaptador nuevo —IndexedDB hoy, SQLite en Android mañana— se aprueba corriendo esta misma
 * suite. No hay tests "del adaptador" separados de los del puerto: si dos adaptadores no se
 * comportan igual, la app se rompe sólo en el dispositivo de un cliente y no en los tests.
 *
 * `crear` tiene que devolver un store **vacío** en cada llamada.
 */

import { describe, expect, it } from 'vitest'
import { proyeccionStock, proyeccionTurno, resumirTurno } from '@altoke/domain'
import type { Evento } from '@altoke/domain'
import type { PosStore } from './pos-store'

const TENANT = 'kiosco-1'
const TERMINAL = 'term-1'
const OTRA_TERMINAL = 'term-2'

let contador = 0

function evento(secuencia: number, resto: object, terminalId: string = TERMINAL): Evento {
  return {
    id: `evt-${++contador}`,
    tenantId: TENANT,
    terminalId,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    ...resto,
  } as Evento
}

const AJUSTE_INICIAL = { tipo: 'ajuste_stock', sku: 'alfajor', delta: 10, causa: 'inicial' } as const

export function probarContratoPosStore(crear: () => Promise<PosStore>): void {
  describe('contrato PosStore', () => {
    it('un libro vacío no tiene eventos ni stock', async () => {
      const store = await crear()

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([])
      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({})
    })

    it('devuelve los eventos de la terminal pedida, en orden de secuencia', async () => {
      const store = await crear()
      await store.append([
        evento(2, { ...AJUSTE_INICIAL, delta: 2 }),
        evento(1, AJUSTE_INICIAL),
        evento(1, AJUSTE_INICIAL, OTRA_TERMINAL),
      ])

      const eventos = await store.leerDesde(TERMINAL, 0)

      expect(eventos.map((e) => e.secuencia)).toEqual([1, 2])
      expect(eventos.every((e) => e.terminalId === TERMINAL)).toBe(true)
    })

    it('devuelve sólo lo posterior a la secuencia acusada', async () => {
      const store = await crear()
      await store.append([evento(1, AJUSTE_INICIAL), evento(2, AJUSTE_INICIAL), evento(3, AJUSTE_INICIAL)])

      const pendientes = await store.leerDesde(TERMINAL, 1)

      expect(pendientes.map((e) => e.secuencia)).toEqual([2, 3])
    })

    it('preserva el evento exactamente como se guardó', async () => {
      const store = await crear()
      const original = evento(1, {
        tipo: 'item_agregado',
        ventaId: 'v1',
        sku: 'alfajor',
        cantidad: 2,
        precioUnitarioCentavos: 1250,
      })

      await store.append([original])

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([original])
    })

    it('proyecta el stock desde lo guardado', async () => {
      const store = await crear()
      await store.append([
        evento(1, AJUSTE_INICIAL),
        evento(2, {
          tipo: 'item_agregado',
          ventaId: 'v1',
          sku: 'alfajor',
          cantidad: 3,
          precioUnitarioCentavos: 1000,
        }),
      ])

      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({ alfajor: 7 })
    })

    it('proyecta un turno completo con su caja', async () => {
      const store = await crear()
      await store.append([
        evento(1, { tipo: 'turno_abierto', turnoId: 'turno-1', fondoCentavos: 5000 }),
        evento(2, { tipo: 'venta_iniciada', ventaId: 'v1', turnoId: 'turno-1' }),
        evento(3, {
          tipo: 'item_agregado',
          ventaId: 'v1',
          sku: 'alfajor',
          cantidad: 2,
          precioUnitarioCentavos: 1000,
        }),
        evento(4, { tipo: 'pago_registrado', ventaId: 'v1', medio: 'efectivo', montoCentavos: 2000 }),
        evento(5, { tipo: 'venta_confirmada', ventaId: 'v1', totalCentavos: 2000 }),
      ])

      const resumen = resumirTurno(await store.proyectar(proyeccionTurno()))

      expect(resumen).toMatchObject({
        turnoId: 'turno-1',
        abierto: true,
        fondoCentavos: 5000,
        totalCentavos: 2000,
        cobradoCentavos: 2000,
        diferenciaCentavos: 0,
      })
    })

    it('ordena por fecha cuando hay varias terminales', async () => {
      const store = await crear()
      await store.append([
        {
          ...evento(
            1,
            { tipo: 'turno_abierto', turnoId: 'turno-b', fondoCentavos: 100 },
            OTRA_TERMINAL,
          ),
          ocurridoEn: '2026-11-22T11:00:00.000Z',
        },
        {
          ...evento(2, { tipo: 'turno_abierto', turnoId: 'turno-a', fondoCentavos: 200 }),
          ocurridoEn: '2026-11-22T10:00:00.000Z',
        },
      ])

      // Manda la fecha: el turno de las 11 abre último y deja su fondo.
      expect(resumirTurno(await store.proyectar(proyeccionTurno())).fondoCentavos).toBe(100)
    })

    it('con la misma fecha desempata por secuencia y no por terminal', async () => {
      const store = await crear()
      await store.append([
        evento(1, { tipo: 'turno_abierto', turnoId: 'turno-a', fondoCentavos: 7000 }),
        evento(2, { tipo: 'turno_abierto', turnoId: 'turno-b', fondoCentavos: 5000 }, OTRA_TERMINAL),
      ])

      expect(resumirTurno(await store.proyectar(proyeccionTurno())).fondoCentavos).toBe(5000)
    })

    it('rechaza un evento inválido y no guarda ninguno del lote', async () => {
      const store = await crear()

      await expect(
        store.append([
          evento(1, AJUSTE_INICIAL),
          evento(2, { tipo: 'ajuste_stock', sku: 'alfajor', delta: 1.5, causa: 'roto' }),
        ]),
      ).rejects.toThrow(RangeError)

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([])
      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({})
    })

    it('es idempotente por id: reenviar el mismo evento no lo duplica', async () => {
      const store = await crear()
      const lote = [evento(1, AJUSTE_INICIAL)]

      await store.append(lote)
      await store.append(lote)

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual(lote)
      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({ alfajor: 10 })
    })

    it('limpiar deja el libro vacío', async () => {
      const store = await crear()
      await store.append([evento(1, AJUSTE_INICIAL)])

      await store.limpiar()

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([])
    })

    it('un append vacío no rompe nada', async () => {
      const store = await crear()

      await expect(store.append([])).resolves.toBeUndefined()
      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([])
    })

    it('con la misma fecha y la misma secuencia desempata por terminalId', async () => {
      const store = await crear()
      await store.append([
        evento(1, { tipo: 'turno_abierto', turnoId: 'turno-b', fondoCentavos: 200 }, 'term-b'),
        evento(1, { tipo: 'turno_abierto', turnoId: 'turno-a', fondoCentavos: 100 }, 'term-a'),
      ])

      // 'term-a' < 'term-b': el turno de term-b se aplica último y deja su fondo.
      expect(resumirTurno(await store.proyectar(proyeccionTurno())).fondoCentavos).toBe(200)
    })

    it('rechaza una secuencia acusada que no sirve como clave', async () => {
      const store = await crear()

      await expect(store.leerDesde(TERMINAL, -1)).rejects.toThrow(RangeError)
      await expect(store.leerDesde(TERMINAL, 1.5)).rejects.toThrow(RangeError)
      await expect(store.leerDesde(TERMINAL, Number.MAX_SAFE_INTEGER)).rejects.toThrow(RangeError)
    })

    it('el mismo id dos veces en un lote guarda un solo evento', async () => {
      const store = await crear()
      const unico = evento(1, AJUSTE_INICIAL)

      await store.append([unico, unico])

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([unico])
      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({ alfajor: 10 })
    })

    it('lo guardado es una copia: mutar el evento original no cambia el libro', async () => {
      const store = await crear()
      const original = evento(1, AJUSTE_INICIAL)

      await store.append([original])
      ;(original as unknown as { delta: number }).delta = 999

      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({ alfajor: 10 })
    })

    it('un evento que no se puede clonar rechaza el lote y no guarda nada', async () => {
      const store = await crear()
      const enfermo = {
        ...evento(2, AJUSTE_INICIAL),
        extra: () => 1,
      } as unknown as Evento

      await expect(store.append([evento(1, AJUSTE_INICIAL), enfermo])).rejects.toThrow()

      await expect(store.leerDesde(TERMINAL, 0)).resolves.toEqual([])
      await expect(store.proyectar(proyeccionStock())).resolves.toEqual({})
    })
  })
}
