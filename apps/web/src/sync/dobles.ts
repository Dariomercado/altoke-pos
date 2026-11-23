/**
 * Dobles de test del sync (`apps/web/src/sync/`): un transporte guionado y un almacén de acuses en
 * memoria, para que cada caso diga sólo lo que le importa.
 *
 * No es código de producción: nada de la app importa este archivo. Vive en `src` y no en un
 * `__tests__/` porque el proyecto no usa esa convención (`apps/api/src/dobles.ts` es igual).
 */

import type { Evento } from '@altoke/domain'
import type { SyncEmpujarSolicitud, SyncTraerConsulta, SyncTraerRespuesta } from './contrato.ts'
import type { RespuestaDeEmpuje, ResultadoDeRed, TransporteDeSync } from './transporte.ts'
import type { AlmacenDeAcuses } from './almacen-local.ts'

export const TENANT_DE_PRUEBA = 'tenant-1'
export const TERMINAL_DE_PRUEBA = 'term-1'
export const TERMINAL_AJENA = 'term-2'

/** Un evento válido y mínimo, con la forma que la caja escribe en el libro. */
export function eventoDePrueba(
  secuencia: number,
  resto: object = {},
  terminalId: string = TERMINAL_DE_PRUEBA,
): Evento {
  return {
    id: `evt-${terminalId}-${secuencia}`,
    tenantId: TENANT_DE_PRUEBA,
    terminalId,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta: 1,
    causa: 'compra',
    ...resto,
  } as unknown as Evento
}

export function acuseDe(terminalId: string, ultimaSecuencia: number): {
  readonly terminalId: string
  readonly ultimaSecuencia: number
} {
  return { terminalId, ultimaSecuencia }
}

/** Una respuesta de empuje con las cuatro listas que el contrato exige y los huecos del servidor. */
export function respuestaDeEmpuje(campos: {
  readonly terminalId?: string
  readonly acuse?: number
  readonly huecos?: readonly number[]
  readonly aceptados?: readonly Evento[]
  readonly duplicados?: readonly Evento[]
  readonly rechazados?: readonly { readonly id: string; readonly motivo: string }[]
}): RespuestaDeEmpuje {
  const terminalId = campos.terminalId ?? TERMINAL_DE_PRUEBA
  const referencia = (evento: Evento): { readonly id: string; readonly secuencia: number } => ({
    id: evento.id,
    secuencia: evento.secuencia,
  })
  const aceptados = (campos.aceptados ?? []).map(referencia)
  const duplicados = (campos.duplicados ?? []).map(referencia)

  return {
    aceptados,
    duplicados,
    conflictos: [],
    rechazados: (campos.rechazados ?? []).map((rechazo) => ({ ...rechazo })),
    acuse: acuseDe(terminalId, campos.acuse ?? 0),
    huecos: [...(campos.huecos ?? [])],
  }
}

export interface TransporteDePrueba extends TransporteDeSync {
  readonly empujes: SyncEmpujarSolicitud[]
  readonly traidas: SyncTraerConsulta[]
}

type GuionDeEmpuje = (
  solicitud: SyncEmpujarSolicitud,
  numero: number,
) => ResultadoDeRed<RespuestaDeEmpuje> | Promise<ResultadoDeRed<RespuestaDeEmpuje>>

type GuionDeTraida = (
  consulta: SyncTraerConsulta,
  numero: number,
) => ResultadoDeRed<SyncTraerRespuesta> | Promise<ResultadoDeRed<SyncTraerRespuesta>>

/**
 * Transporte guionado. Sin guion acepta todo lo empujado (acuse = máxima secuencia del lote) y
 * devuelve páginas vacías; cada test reemplaza sólo lo que necesita.
 */
export function transporteDePrueba(guiones: {
  readonly empujar?: GuionDeEmpuje | undefined
  readonly traer?: GuionDeTraida | undefined
} = {}): TransporteDePrueba {
  const empujes: SyncEmpujarSolicitud[] = []
  const traidas: SyncTraerConsulta[] = []

  return {
    empujes,
    traidas,
    async empujar(solicitud) {
      empujes.push(solicitud)
      if (guiones.empujar !== undefined) return guiones.empujar(solicitud, empujes.length)

      const secuencias = solicitud.eventos.map((evento) => evento.secuencia)
      return {
        ok: true,
        dato: respuestaDeEmpuje({
          terminalId: solicitud.terminalId,
          acuse: secuencias.length === 0 ? 0 : Math.max(...secuencias),
          aceptados: solicitud.eventos,
        }),
      }
    },
    async traer(consulta) {
      traidas.push(consulta)
      if (guiones.traer !== undefined) return guiones.traer(consulta, traidas.length)

      return {
        ok: true,
        dato: {
          eventos: [],
          acuse: acuseDe(consulta.terminalId, 0),
          hayMas: false,
          siguienteDesde: null,
        },
      }
    },
  }
}

export interface AcusesDePrueba {
  readonly acuses: AlmacenDeAcuses
  readonly valores: Map<string, number>
}

/** Acuse en memoria, con el mapa a la vista para afirmar qué quedó persistido. */
export function acusesEnMemoria(inicial = 0): AcusesDePrueba {
  const valores = new Map<string, number>()

  return {
    valores,
    acuses: {
      async leer(terminalId: string): Promise<number> {
        return valores.get(terminalId) ?? inicial
      },
      async guardar(terminalId: string, ultimaSecuencia: number): Promise<void> {
        valores.set(terminalId, ultimaSecuencia)
      },
    },
  }
}
