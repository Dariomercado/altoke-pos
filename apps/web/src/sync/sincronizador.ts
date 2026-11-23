/**
 * El sincronizador de la terminal (docs/specs/0001-arquitectura.md §I2, `0003` §Sync).
 *
 * `sincronizar()` empuja lo pendiente y después trae lo de las otras terminales. Nunca lanza hacia
 * la UI: cada falla es un **estado** (`sin_sesion`, `sincronizando`, `al_dia`, `pendiente` con su
 * conteo, `sin_red`) y el libro queda intacto. Offline es normal: fallar no borra nada y el próximo
 * intento arranca del acuse guardado.
 *
 * Tres garantías que este archivo hace cumplir:
 *
 *   - **El acuse avanza sólo con un empuje exitoso.** Es lo que decide qué se reenvía; adelantarlo
 *     por una respuesta perdida dejaría ventas sin subir para siempre. El acuse del servidor es el
 *     máximo contiguo desde 1, así que nunca salta un hueco; si el libro no tiene la secuencia que
 *     el servidor reporta faltante, no se inventa.
 *   - **Un evento traído que no valida no entra y no corta la página.** Se migra con `migrarEvento`,
 *     se valida con `validarEvento` y se descarta —contado— si falla, como pide `0003` §Sync.
 *   - **La red no decide una venta.** Un fallo de red se reintenta con backoff exponencial y jitter
 *     acotado; agotados los intentos, el estado lo dice y el libro sigue igual.
 */

import {
  migrarEvento,
  proyeccionSobreventas,
  validarEvento,
} from '@altoke/domain'
import type { Evento, SobreventasPorVenta } from '@altoke/domain'
import type { PosStore } from '@altoke/store'
import type { AlmacenDeAcuses } from './almacen-local.ts'
import { pendientesDe } from './cola.ts'
import type { ErrorDeTransporte, ResultadoDeRed, TransporteDeSync } from './transporte.ts'

export type EstadoSync =
  | { readonly tipo: 'sin_sesion'; readonly motivo: 'no_autenticado' | 'sin_permiso' }
  | { readonly tipo: 'sincronizando'; readonly pendientes: number }
  | { readonly tipo: 'al_dia' }
  | { readonly tipo: 'pendiente'; readonly pendientes: number }
  | { readonly tipo: 'sin_red'; readonly pendientes: number }

/** Lo que la UI dibuja de una sola lectura: el estado del sync y las alertas de sobreventa. */
export interface InstantaneaSync {
  readonly estado: EstadoSync
  readonly alertas: SobreventasPorVenta
  /** Eventos traídos que no se aplicaron por inválidos o de otro tenant. Se cuentan, no se callan. */
  readonly descartados: number
}

export interface SesionDeSync {
  readonly tenantId: string
  readonly terminalId: string
}

export interface OpcionesSincronizador {
  readonly store: PosStore
  readonly transporte: TransporteDeSync
  readonly acuses: AlmacenDeAcuses
  /** `null` es "no hay sesión": el sync no llama a la red y lo dice. */
  readonly sesion: SesionDeSync | null
  /** Inyectables para test: en la app son `setTimeout`, `Math.random` y el navegador. */
  readonly dormir?: ((ms: number) => Promise<void>) | undefined
  readonly aleatorio?: (() => number) | undefined
  readonly intentos?: number | undefined
  readonly esperaBaseMs?: number | undefined
  readonly esperaMaximaMs?: number | undefined
}

export interface Sincronizador {
  sincronizar(): Promise<InstantaneaSync>
  /** Relee el libro sin tocar la red: conteo de pendientes y alertas. */
  refrescar(): Promise<InstantaneaSync>
  pendientes(): Promise<Evento[]>
  instantanea(): InstantaneaSync
  suscribir(oyente: (instantanea: InstantaneaSync) => void): () => void
}

export const DESDE_EL_PRINCIPIO = '1970-01-01T00:00:00.000Z'

const INTENTOS_POR_DEFECTO = 4
const ESPERA_BASE_MS = 250
const ESPERA_MAXIMA_MS = 8_000
/** Tope de un lote de empuje: el servidor ya pagina la traída en 200. */
const LOTE_MAXIMO = 200
/** Un ciclo del empuje no puede quedar girando si el servidor responde siempre lo mismo. */
const MAXIMO_VUELTAS = 20
const MAXIMO_PAGINAS = 1_000

/** Espera del próximo intento: exponencial, con techo y jitter acotado (nunca cero). */
export function esperaDeReintento(
  intento: number,
  opciones: {
    readonly baseMs: number
    readonly maximoMs: number
    readonly aleatorio: () => number
  },
): number {
  const exponencial = Math.min(opciones.maximoMs, opciones.baseMs * 2 ** Math.max(0, intento))
  const azar = Math.min(Math.max(opciones.aleatorio(), 0), 1)

  // Hasta +50%: dos terminales que reintentan juntas en el mismo kiosco no se pisan en el servidor.
  return Math.round(exponencial * (1 + azar * 0.5))
}

export function crearSincronizador(opciones: OpcionesSincronizador): Sincronizador {
  const { store, transporte, acuses, sesion } = opciones
  const dormir =
    opciones.dormir ?? ((ms: number): Promise<void> => new Promise((resolver) => setTimeout(resolver, ms)))
  const aleatorio = opciones.aleatorio ?? ((): number => Math.random())
  const intentos = Math.max(1, opciones.intentos ?? INTENTOS_POR_DEFECTO)
  const baseMs = opciones.esperaBaseMs ?? ESPERA_BASE_MS
  const maximoMs = opciones.esperaMaximaMs ?? ESPERA_MAXIMA_MS
  const oyentes = new Set<(instantanea: InstantaneaSync) => void>()

  let actual: InstantaneaSync = {
    estado:
      sesion === null
        ? { tipo: 'sin_sesion', motivo: 'no_autenticado' }
        : { tipo: 'pendiente', pendientes: 0 },
    alertas: {},
    descartados: 0,
  }

  function publicar(instantanea: InstantaneaSync): InstantaneaSync {
    actual = instantanea

    for (const oyente of [...oyentes]) {
      try {
        oyente(instantanea)
      } catch {
        // Un oyente roto (un componente que se desmontó a mitad de render) no puede romper el
        // sync ni la venta.
      }
    }

    return instantanea
  }

  async function conReintentos<T>(
    operacion: () => Promise<ResultadoDeRed<T>>,
  ): Promise<ResultadoDeRed<T>> {
    for (let intento = 0; ; intento += 1) {
      const resultado = await operacion()
      if (resultado.ok) return resultado
      // Sólo la red se reintenta: un 400 o un 403 no se arreglan esperando.
      if (resultado.error.motivo !== 'red' || intento >= intentos - 1) return resultado

      await dormir(esperaDeReintento(intento, { baseMs, maximoMs, aleatorio }))
    }
  }

  async function pendientesDeSesion(s: SesionDeSync): Promise<Evento[]> {
    const acuse = await acuses.leer(s.terminalId)
    return pendientesDe(store, s.terminalId, acuse)
  }

  async function alertasProyectadas(): Promise<SobreventasPorVenta> {
    try {
      return await store.proyectar(proyeccionSobreventas())
    } catch {
      // Sin proyección no hay alertas nuevas; las últimas conocidas se mantienen.
      return actual.alertas
    }
  }

  async function contarPendientesSeguro(s: SesionDeSync): Promise<number> {
    try {
      return (await pendientesDeSesion(s)).length
    } catch {
      return actual.estado.tipo === 'pendiente' || actual.estado.tipo === 'sin_red'
        ? actual.estado.pendientes
        : 0
    }
  }

  async function instantaneaReal(
    s: SesionDeSync,
    descartados: number,
  ): Promise<InstantaneaSync> {
    const pendientes = await pendientesDeSesion(s)
    return publicar({
      estado:
        pendientes.length === 0
          ? { tipo: 'al_dia' }
          : { tipo: 'pendiente', pendientes: pendientes.length },
      alertas: await alertasProyectadas(),
      descartados,
    })
  }

  async function instantaneaDeFallo(
    s: SesionDeSync,
    error: ErrorDeTransporte,
    descartados: number,
  ): Promise<InstantaneaSync> {
    const pendientes = await contarPendientesSeguro(s)
    const alertas = await alertasProyectadas()

    switch (error.motivo) {
      case 'no_autenticado':
        return { estado: { tipo: 'sin_sesion', motivo: 'no_autenticado' }, alertas, descartados }
      case 'sin_permiso':
        return { estado: { tipo: 'sin_sesion', motivo: 'sin_permiso' }, alertas, descartados }
      case 'red':
        return { estado: { tipo: 'sin_red', pendientes }, alertas, descartados }
      default:
        // `validacion` o `respuesta_invalida`: el libro queda como está y lo pendiente sigue
        // pendiente. No es una caída de red y no se reintenta en el mismo ciclo.
        return { estado: { tipo: 'pendiente', pendientes }, alertas, descartados }
    }
  }

  /**
   * Empuja lo pendiente. Devuelve `ok: false` sin tocar el acuse si una llamada falla.
   *
   * Los `huecos` del servidor se reenvían **exactos**: el siguiente lote son los eventos del libro
   * en esas secuencias. Si el libro no los tiene —un hueco de verdad— no se inventan y el ciclo
   * termina con lo pendiente a la vista.
   */
  async function empujar(s: SesionDeSync): Promise<
    { readonly ok: true } | { readonly ok: false; readonly error: ErrorDeTransporte }
  > {
    let acuse = await acuses.leer(s.terminalId)
    let huecos: readonly number[] = []
    let huecosAnteriores: readonly number[] = []

    for (let vuelta = 0; vuelta < MAXIMO_VUELTAS; vuelta += 1) {
      const pendientes = await pendientesDe(store, s.terminalId, acuse)
      if (pendientes.length === 0) return { ok: true }

      const delHueco =
        huecos.length > 0
          ? pendientes.filter((evento) => huecos.includes(evento.secuencia))
          : pendientes
      const lote = delHueco.slice(0, LOTE_MAXIMO)
      // Un hueco que el libro no tiene no se completa: no hay nada que mandar.
      if (lote.length === 0) return { ok: true }

      const respuesta = await conReintentos(() =>
        transporte.empujar({ terminalId: s.terminalId, eventos: lote }),
      )
      if (!respuesta.ok) return { ok: false, error: respuesta.error }

      const anterior = acuse
      acuse = avanzarAcuse(anterior, respuesta.dato.acuse.ultimaSecuencia)
      // **Sólo acá** se persiste: una respuesta que no llegó no acusa nada.
      if (acuse !== anterior) await acuses.guardar(s.terminalId, acuse)

      huecos = respuesta.dato.huecos
      const sinProgreso = acuse === anterior && mismoConjunto(huecos, huecosAnteriores)
      if (sinProgreso) return { ok: true }
      huecosAnteriores = huecos
    }

    return { ok: true }
  }

  /** Trae todas las páginas y aplica lo que valide. Cuenta lo descartado. */
  async function traer(
    s: SesionDeSync,
  ): Promise<
    | { readonly ok: true; readonly descartados: number }
    | { readonly ok: false; readonly error: ErrorDeTransporte; readonly descartados: number }
  > {
    let desde = DESDE_EL_PRINCIPIO
    let descartados = 0

    for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina += 1) {
      const respuesta = await conReintentos(() => transporte.traer({ terminalId: s.terminalId, desde }))
      if (!respuesta.ok) return { ok: false, error: respuesta.error, descartados }

      const validos: Evento[] = []
      for (const crudo of respuesta.dato.eventos) {
        try {
          // 0003 §schemaVersion y §Traer: migrar y validar **antes** de escribir. Un evento de otra
          // versión se migra en memoria; uno corrupto o de otro tenant se descarta y se cuenta.
          const migrado = migrarEvento(crudo)
          validarEvento(migrado)
          if (migrado.tenantId !== s.tenantId) throw new RangeError('El evento es de otro tenant.')
          validos.push(migrado)
        } catch {
          descartados += 1
        }
      }

      if (validos.length > 0) await store.append(validos)
      if (!respuesta.dato.hayMas || respuesta.dato.siguienteDesde === null) break

      desde = respuesta.dato.siguienteDesde
    }

    return { ok: true, descartados }
  }

  return {
    async sincronizar(): Promise<InstantaneaSync> {
      if (sesion === null) {
        return publicar({
          estado: { tipo: 'sin_sesion', motivo: 'no_autenticado' },
          alertas: actual.alertas,
          descartados: actual.descartados,
        })
      }

      try {
        const pendientes = await pendientesDeSesion(sesion)
        publicar({
          ...actual,
          estado: { tipo: 'sincronizando', pendientes: pendientes.length },
        })

        const empuje = await empujar(sesion)
        if (!empuje.ok) {
          return publicar(await instantaneaDeFallo(sesion, empuje.error, actual.descartados))
        }

        const traida = await traer(sesion)
        if (!traida.ok) {
          return publicar(await instantaneaDeFallo(sesion, traida.error, traida.descartados))
        }

        return await instantaneaReal(sesion, traida.descartados)
      } catch {
        // IndexedDB bloqueada, store que no contesta: el sync no puede tumbar la pantalla.
        return publicar({
          estado: { tipo: 'pendiente', pendientes: await contarPendientesSeguro(sesion) },
          alertas: await alertasProyectadas(),
          descartados: actual.descartados,
        })
      }
    },

    async refrescar(): Promise<InstantaneaSync> {
      if (sesion === null) {
        return publicar({
          ...actual,
          estado: { tipo: 'sin_sesion', motivo: 'no_autenticado' },
        })
      }

      try {
        return await instantaneaReal(sesion, actual.descartados)
      } catch {
        return actual
      }
    },

    async pendientes(): Promise<Evento[]> {
      if (sesion === null) return []

      try {
        return await pendientesDeSesion(sesion)
      } catch {
        return []
      }
    },

    instantanea(): InstantaneaSync {
      return actual
    },

    suscribir(oyente: (instantanea: InstantaneaSync) => void): () => void {
      oyentes.add(oyente)
      return () => {
        oyentes.delete(oyente)
      }
    },
  }
}

/** El acuse nunca retrocede: un `GET` o un empuje viejo no puede achicar lo ya acusado. */
function avanzarAcuse(actual: number, delServidor: number): number {
  if (
    !Number.isInteger(delServidor) ||
    delServidor < 0 ||
    delServidor >= Number.MAX_SAFE_INTEGER
  ) {
    return actual
  }

  return Math.max(actual, delServidor)
}

function mismoConjunto(uno: readonly number[], otro: readonly number[]): boolean {
  if (uno.length !== otro.length) return false
  const ordenados = [...uno].sort((a, b) => a - b)
  const otros = [...otro].sort((a, b) => a - b)
  return ordenados.every((valor, indice) => valor === otros[indice])
}
