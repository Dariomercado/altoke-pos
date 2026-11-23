/**
 * La cadena de migraciones de `schemaVersion` (docs/specs/0003-api-y-sync.md §schemaVersion,
 * odd/tasks/altoke-m2-sync.md T7).
 *
 * Traga que este archivo evita: inventar un cambio real de esquema. En M2 sólo existe `v1`, así
 * que **la cadena real está vacía** y los pasos de acá son sintéticos: viven sólo en este test,
 * para ejercitar la composición. Un paso falso en `CADENA_DE_MIGRACIONES` sería peor que no tener
 * ninguno, porque habría que mantenerlo y nadie sabría qué datos transforma.
 *
 * Lo que se prueba, en términos de comportamiento:
 *   - un evento `v1` sale `v2` con la transformación del paso aplicada, y el resultado valida,
 *   - los pasos se aplican en orden, uno por versión, cada uno sobre la salida del anterior,
 *   - leer dos veces el mismo evento guardado da el mismo resultado: migrar es en memoria y la
 *     fila no cambia,
 *   - el objeto del llamador no se muta, ni siquiera si un paso muta su argumento,
 *   - una versión más nueva que la cadena lanza en vez de aplicarse, y una cadena incompleta
 *     también: ninguna de las dos se resuelve devolviendo algo "parecido".
 */

import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION_ACTUAL } from './eventos'
import type { Evento } from './eventos'
import {
  CADENA_DE_MIGRACIONES,
  MigracionAusente,
  VersionDeSchemaFutura,
  migrarEvento,
} from './migraciones'
import type { CadenaDeMigraciones, CuerpoDeEvento, PasoDeMigracion } from './migraciones'

const TENANT = 'kiosco-1'
const TERMINAL = 'term-1'

/** Un evento `v1` válido y mínimo, con la forma que la caja escribe en el libro. */
function enV1(resto: object = {}): Evento {
  return {
    id: 'evt-1',
    tenantId: TENANT,
    terminalId: TERMINAL,
    secuencia: 1,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta: 1,
    causa: 'compra',
    ...resto,
  } as Evento
}

/** El resultado de una cadena sintética no es un `Evento` de hoy: se mira como cuerpo crudo. */
function cuerpo(valor: unknown): CuerpoDeEvento {
  return valor as CuerpoDeEvento
}

/** Paso sintético `v1 → v2`: agrega un campo. Ningún cambio así existe todavía en el producto. */
const PASO_V1_A_V2: PasoDeMigracion = {
  desde: 1,
  aplicar: (evento) => ({ ...evento, origen: 'terminal' }),
}

/** Paso sintético `v2 → v3`: se apoya en lo que dejó el anterior, para probar el orden. */
const PASO_V2_A_V3: PasoDeMigracion = {
  desde: 2,
  aplicar: (evento) => ({ ...evento, historial: [evento['origen'], 'v3'] }),
}

const CADENA_V2: CadenaDeMigraciones = { hasta: 2, pasos: [PASO_V1_A_V2] }
const CADENA_V3: CadenaDeMigraciones = { hasta: 3, pasos: [PASO_V1_A_V2, PASO_V2_A_V3] }

describe('migrarEvento — la cadena vN → vN+1', () => {
  it('compone: un evento v1 sale v2 con la transformación aplicada y el resto intacto', () => {
    const migrado = cuerpo(migrarEvento(enV1(), CADENA_V2))

    expect(migrado['schemaVersion']).toBe(2)
    expect(migrado['origen']).toBe('terminal')
    // El cuerpo viaja entero: un paso agrega o cambia lo suyo, no reconstruye el evento.
    expect(migrado['sku']).toBe('alfajor')
    expect(migrado['causa']).toBe('compra')
    expect(migrado['secuencia']).toBe(1)
  })

  it('aplica los pasos en orden: cada uno recibe la salida del anterior', () => {
    const migrado = cuerpo(migrarEvento(enV1(), CADENA_V3))

    expect(migrado['schemaVersion']).toBe(3)
    expect(migrado['historial']).toEqual(['terminal', 'v3'])
  })

  it('lee dos veces el mismo evento guardado y da el mismo resultado', () => {
    const guardado = enV1()

    const primera = migrarEvento(guardado, CADENA_V2)
    const segunda = migrarEvento(guardado, CADENA_V2)

    expect(segunda).toStrictEqual(primera)
    // Y la fila no se tocó: la migración es en memoria (0003 §schemaVersion).
    expect(guardado).toStrictEqual(enV1())
  })

  it('no muta el evento del llamador, ni aunque un paso mute su argumento', () => {
    const guardado = enV1()
    const queMuta: CadenaDeMigraciones = {
      hasta: 2,
      pasos: [
        {
          desde: 1,
          aplicar: (evento) => {
            evento['sku'] = 'mutado'
            return evento
          },
        },
      ],
    }

    const migrado = cuerpo(migrarEvento(guardado, queMuta))

    expect(migrado['sku']).toBe('mutado')
    expect(cuerpo(guardado)['sku'], 'lo guardado se lee sobre una copia').toBe('alfajor')
  })

  it('la cadena real está vacía y un evento de la versión actual es un no-op', () => {
    // Un paso inventado sin cambio de esquema habría que mantenerlo para siempre y nadie sabría
    // qué datos transforma. Cuando llegue la primera migración real, este test se actualiza a
    // propósito: es el recordatorio de que la cadena no es decorativa.
    expect(CADENA_DE_MIGRACIONES.pasos).toEqual([])
    expect(CADENA_DE_MIGRACIONES.hasta).toBe(SCHEMA_VERSION_ACTUAL)

    const guardado = enV1()
    expect(migrarEvento(guardado)).toStrictEqual(guardado)
  })

  it('una versión más nueva que la cadena lanza en vez de aplicarse', () => {
    const delFuturo = { ...enV1(), schemaVersion: 2 }

    // Contra la cadena real, que sólo entiende hasta v1...
    expect(() => migrarEvento(delFuturo)).toThrow(VersionDeSchemaFutura)
    // ...y contra una cadena inyectada que llega hasta v2.
    expect(() => migrarEvento({ ...enV1(), schemaVersion: 3 }, CADENA_V2)).toThrow(
      VersionDeSchemaFutura,
    )
    expect(() => migrarEvento(delFuturo)).toThrow(/más nueva/)
  })

  it('una cadena a la que le falta un paso lanza en vez de devolver la versión vieja', () => {
    expect(() => migrarEvento(enV1(), { hasta: 2, pasos: [] })).toThrow(MigracionAusente)
  })

  it('valida el resultado: un paso que rompe el cuerpo no produce un evento migrado', () => {
    const queRompe: CadenaDeMigraciones = {
      hasta: 2,
      pasos: [{ desde: 1, aplicar: (evento) => ({ ...evento, delta: 0.5 }) }],
    }

    expect(() => migrarEvento(enV1(), queRompe)).toThrow(RangeError)
  })

  it.each([0, -1, 1.5, '1', undefined])(
    'un evento con schemaVersion ilegible no se migra: %s',
    (version) => {
      expect(() => migrarEvento({ ...enV1(), schemaVersion: version })).toThrow(RangeError)
    },
  )

  it.each([null, 'un evento', 42, [], undefined])('rechaza lo que no es un evento guardado: %s', (valor) => {
    expect(() => migrarEvento(valor)).toThrow(TypeError)
  })
})
