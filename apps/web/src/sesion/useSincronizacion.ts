/**
 * El sync atado a la pantalla (T9 de `odd/tasks/altoke-m2-sync.md`, cableado en T10).
 *
 * Arranca **una vez hay sesión**, empuja al montar y en cada intervalo, y publica la instantánea
 * que el encabezado dibuja. No bloquea el cobro: la venta ya está en el libro antes de que este
 * hook se entere, y un fallo de sync sólo cambia el chip.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PosStore } from '@altoke/store'
import {
  crearAlmacenDeAcuses,
  crearSincronizador,
  crearTransporteFetch,
} from '../sync'
import type {
  AlmacenDeAcuses,
  InstantaneaSync,
  Sincronizador,
  TransporteDeSync,
} from '../sync'
import { baseUrlDesdeEntorno } from './cliente.ts'
import type { SesionActiva } from './tipos.ts'

/** Cada cuánto se reintenta el ciclo sin que nadie toque nada. */
export const INTERVALO_DE_SYNC_MS = 30_000

const SIN_SESION: InstantaneaSync = {
  estado: { tipo: 'sin_sesion', motivo: 'no_autenticado' },
  alertas: {},
  descartados: 0,
}

const INICIANDO: InstantaneaSync = {
  estado: { tipo: 'sincronizando', pendientes: 0 },
  alertas: {},
  descartados: 0,
}

/**
 * Sólo lo que un test necesita reemplazar. El transporte real, los acuses de IndexedDB y el
 * intervalo tienen valores por defecto; el resto son perillas para no esperar backoff en un test.
 */
export interface OpcionesSincronizacionApp {
  readonly transporte?: TransporteDeSync | undefined
  readonly acuses?: AlmacenDeAcuses | undefined
  readonly intervaloMs?: number | undefined
  readonly intentos?: number | undefined
  readonly esperaBaseMs?: number | undefined
  readonly esperaMaximaMs?: number | undefined
  readonly dormir?: ((ms: number) => Promise<void>) | undefined
  readonly aleatorio?: (() => number) | undefined
}

interface OpcionesUseSincronizacion extends OpcionesSincronizacionApp {
  readonly store: PosStore | null
  readonly sesion: SesionActiva | null
  readonly terminalId: string
}

export function useSincronizacion(opciones: OpcionesUseSincronizacion): {
  readonly instantanea: InstantaneaSync
  readonly sincronizarAhora: () => void
} {
  const { store, sesion, terminalId } = opciones
  const [instantanea, setInstantanea] = useState<InstantaneaSync>(() =>
    sesion === null ? SIN_SESION : INICIANDO,
  )
  const ref = useRef<Sincronizador | null>(null)

  useEffect(() => {
    if (store === null || sesion === null) {
      ref.current = null
      setInstantanea(SIN_SESION)
      return
    }

    const transporte =
      opciones.transporte ??
      crearTransporteFetch({
        baseUrl: baseUrlDesdeEntorno(),
        token: () => sesion.token,
        tenantId: sesion.tenant.slug,
      })
    const acuses =
      opciones.acuses ??
      crearAlmacenDeAcuses({ indexedDB: globalThis.indexedDB, tenantId: sesion.tenant.id })

    const sincronizador = crearSincronizador({
      store,
      transporte,
      acuses,
      sesion: { tenantId: sesion.tenant.id, terminalId },
      intentos: opciones.intentos,
      esperaBaseMs: opciones.esperaBaseMs,
      esperaMaximaMs: opciones.esperaMaximaMs,
      dormir: opciones.dormir,
      aleatorio: opciones.aleatorio,
    })

    ref.current = sincronizador
    const desuscribir = sincronizador.suscribir(setInstantanea)
    setInstantanea(INICIANDO)
    void sincronizador.sincronizar()

    const intervalo = setInterval(
      () => {
        void sincronizador.sincronizar()
      },
      opciones.intervaloMs ?? INTERVALO_DE_SYNC_MS,
    )

    return () => {
      clearInterval(intervalo)
      desuscribir()
      if (ref.current === sincronizador) ref.current = null
    }
  }, [
    store,
    sesion,
    terminalId,
    opciones.transporte,
    opciones.acuses,
    opciones.intervaloMs,
    opciones.intentos,
    opciones.esperaBaseMs,
    opciones.esperaMaximaMs,
    opciones.dormir,
    opciones.aleatorio,
  ])

  const sincronizarAhora = useCallback((): void => {
    void ref.current?.sincronizar()
  }, [])

  return { instantanea, sincronizarAhora }
}
