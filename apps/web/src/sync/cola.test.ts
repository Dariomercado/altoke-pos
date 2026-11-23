/**
 * La cola de sync es una **derivación**, no un almacén (docs/specs/0001-arquitectura.md §I2,
 * `0003` §Sync).
 *
 * Lo que se prueba, en términos de comportamiento:
 *   - lo que se manda es exactamente "eventos de esta terminal con secuencia mayor al acuse",
 *   - en orden de secuencia y sin repetir un evento que el libro tenga dos veces,
 *   - con acuse cero se manda el libro propio entero,
 *   - la cola se arma del libro y el acuse cada vez: escribir una venta después cambia la cola sin
 *     que nadie refresque una estructura paralela.
 */

import { describe, expect, it } from 'vitest'
import { crearStoreEnMemoria } from '@altoke/store'
import { colaDeSync, pendientesDe } from './cola.ts'
import { TERMINAL_AJENA, TERMINAL_DE_PRUEBA, eventoDePrueba } from './dobles.ts'

describe('colaDeSync', () => {
  it('son los eventos propios después del acuse, en orden de secuencia', () => {
    const libro = [
      eventoDePrueba(3),
      eventoDePrueba(1),
      eventoDePrueba(2),
      eventoDePrueba(9, {}, TERMINAL_AJENA),
    ]

    const cola = colaDeSync(libro, TERMINAL_DE_PRUEBA, 1)

    expect(cola.map((evento) => evento.secuencia)).toEqual([2, 3])
    expect(cola.every((evento) => evento.terminalId === TERMINAL_DE_PRUEBA)).toBe(true)
  })

  it('no repite un evento que el libro tenga dos veces: la cola no duplica', () => {
    const unico = eventoDePrueba(2)

    const cola = colaDeSync([unico, unico, eventoDePrueba(3)], TERMINAL_DE_PRUEBA, 1)

    expect(cola.map((evento) => evento.id)).toEqual([unico.id, eventoDePrueba(3).id])
  })

  it('con acuse cero manda todo el libro propio', () => {
    const libro = [eventoDePrueba(1), eventoDePrueba(2)]

    expect(colaDeSync(libro, TERMINAL_DE_PRUEBA, 0)).toEqual(libro)
  })

  it('un acuse que no es una secuencia válida se rechaza en vez de mandar de más o de menos', () => {
    for (const invalido of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => colaDeSync([], TERMINAL_DE_PRUEBA, invalido)).toThrow(RangeError)
    }
  })
})

describe('pendientesDe', () => {
  it('se deriva del libro y el acuse, no de una cola paralela', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(2)])

    await expect(pendientesDe(store, TERMINAL_DE_PRUEBA, 1)).resolves.toEqual([eventoDePrueba(2)])

    // Una venta nueva aparece en la cola sin que nadie la haya encolado a mano.
    await store.append([eventoDePrueba(3)])
    await expect(pendientesDe(store, TERMINAL_DE_PRUEBA, 1)).resolves.toEqual([
      eventoDePrueba(2),
      eventoDePrueba(3),
    ])

    // Y el acuse del servidor es lo único que la acorta.
    await expect(pendientesDe(store, TERMINAL_DE_PRUEBA, 3)).resolves.toEqual([])
  })

  it('el libro de otra terminal no viaja en la cola de ésta', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDePrueba(1), eventoDePrueba(1, {}, TERMINAL_AJENA)])

    await expect(pendientesDe(store, TERMINAL_DE_PRUEBA, 0)).resolves.toEqual([
      eventoDePrueba(1),
    ])
  })
})
