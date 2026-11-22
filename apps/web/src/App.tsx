/**
 * Pantalla del POS (T7): grilla de productos a la izquierda, venta y cobro a la derecha.
 *
 * Esta capa **no calcula plata**: los totales vienen de `calcularTotales`, el stock proyectado y
 * el resumen del turno del libro, y el arqueo de `armarArqueo`. Todo lo que escribe eventos pasa
 * por la caja (`crearCaja`), que es la única que conoce las reglas del turno.
 *
 * Persistencia: una base IndexedDB por tenant (`0001` §6). El `store` se puede inyectar para los
 * tests, que usan el adaptador en memoria.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DENOMINACIONES, armarArqueo, contarDenominaciones } from '@altoke/domain'
import type { Arqueo, Centavos, ConteoPorDenominacion } from '@altoke/domain'
import { crearIndexedDbStore } from '@altoke/store'
import type { PosStore } from '@altoke/store'
import { CATALOGO, STOCK_INICIAL } from './catalogo'
import type { ProductoDeCatalogo } from './catalogo'
import { AperturaCaja } from './components/AperturaCaja'
import { Encabezado } from './components/Encabezado'
import { GrillaProductos } from './components/GrillaProductos'
import { PanelCierre } from './components/PanelCierre'
import { PanelVenta } from './components/PanelVenta'
import { ResumenArqueo } from './components/ResumenArqueo'
import { Ticket } from './components/Ticket'
import { centavosDesdePesos, pesosDesdeCentavos } from './formato'
import { crearCaja } from './pos/caja'
import type { Caja, EstadoCaja, PagoSolicitado, VentaCobrada } from './pos/caja'
import { calcularTotales } from './pos/venta'
import type { LineaDeVenta } from './pos/venta'

/**
 * Una base por tenant: el nombre de la base local incluye al tenant porque la base local contiene
 * sólo su tenant y se purga al cerrar sesión (`0001` §6). El día que haya alta de tenants, este
 * nombre se deriva del tenant y no se escribe a mano.
 */
export const NOMBRE_BASE = 'altoke-kiosco-1'
export const TENANT_ID = 'kiosco-demo'
export const TERMINAL_ID = 'terminal-1'
export const NOMBRE_TENANT = 'AlToke · Kiosco demo'

/** Fondo con el que arranca el demo: 50 pesos, lo que suele haber en un cajón chico. */
const FONDO_POR_DEFECTO = 5000

export interface AppProps {
  /** Inyectable para tests; en el navegador se usa IndexedDB. */
  readonly store?: PosStore
}

export function App({ store }: AppProps) {
  const [caja, setCaja] = useState<Caja | null>(null)
  const [estado, setEstado] = useState<EstadoCaja | null>(null)
  const [errorDeCarga, setErrorDeCarga] = useState<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [lineas, setLineas] = useState<readonly LineaDeVenta[]>([])
  const [esTarjeta, setEsTarjeta] = useState(false)
  const [efectivoPesos, setEfectivoPesos] = useState(() => pesosDesdeCentavos(0))
  const [venta, setVenta] = useState<VentaCobrada | null>(null)

  const [panelCierre, setPanelCierre] = useState(false)
  const [conteo, setConteo] = useState<ConteoPorDenominacion>({})
  const [ultimoCierre, setUltimoCierre] = useState<Arqueo | null>(null)

  useEffect(() => {
    let vigente = true
    const storeFinal =
      store ?? crearIndexedDbStore({ indexedDB: globalThis.indexedDB, nombreDb: NOMBRE_BASE })
    const cajaNueva = crearCaja({
      store: storeFinal,
      tenantId: TENANT_ID,
      terminalId: TERMINAL_ID,
    })

    async function iniciar(): Promise<void> {
      await cajaNueva.sembrar(STOCK_INICIAL)
      const inicial = await cajaNueva.estado()

      if (!vigente) return

      setCaja(cajaNueva)
      setEstado(inicial)
    }

    iniciar().catch((causa: unknown) => {
      if (vigente) setErrorDeCarga(mensajeDeError(causa))
    })

    return () => {
      vigente = false
    }
  }, [store])

  const totales = useMemo(() => calcularTotales(lineas), [lineas])

  // El efectivo arranca en el total: cobrar con el monto exacto es el caso más común del kiosco.
  useEffect(() => {
    setEfectivoPesos(pesosDesdeCentavos(totales.totalCentavos))
  }, [totales.totalCentavos])

  const agregarProducto = useCallback((producto: ProductoDeCatalogo) => {
    setError(null)
    setLineas((previas) => {
      const existente = previas.find((linea) => linea.sku === producto.sku)

      if (existente === undefined) {
        return [
          ...previas,
          {
            sku: producto.sku,
            nombre: producto.nombre,
            cantidad: 1,
            precioUnitarioCentavos: producto.precioUnitarioCentavos,
            alicuotaBps: producto.alicuotaBps,
          },
        ]
      }

      return previas.map((linea) =>
        linea.sku === producto.sku ? { ...linea, cantidad: linea.cantidad + 1 } : linea,
      )
    })
  }, [])

  const cambiarCantidad = useCallback((sku: string, delta: number) => {
    setLineas((previas) =>
      previas
        .map((linea) =>
          linea.sku === sku ? { ...linea, cantidad: linea.cantidad + delta } : linea,
        )
        .filter((linea) => linea.cantidad > 0),
    )
  }, [])

  async function abrirTurno(fondoPesos: string): Promise<void> {
    if (caja === null) return

    const fondoCentavos = centavosDesdePesos(fondoPesos)

    if (fondoCentavos === null) {
      setError('El fondo no es un monto válido.')
      return
    }

    setError(null)

    try {
      await caja.abrirTurno(fondoCentavos)
      setConteo({})
      setUltimoCierre(null)
      setEstado(await caja.estado())
    } catch (causa) {
      setError(mensajeDeError(causa))
    }
  }

  async function cobrar(): Promise<void> {
    if (caja === null) return

    let pagos: readonly PagoSolicitado[]

    if (esTarjeta) {
      pagos = [{ medio: 'tarjeta_manual', montoCentavos: totales.totalCentavos }]
    } else {
      const recibidoCentavos = centavosDesdePesos(efectivoPesos)

      if (recibidoCentavos === null) {
        setError('El monto en efectivo no es válido.')
        return
      }

      pagos = [{ medio: 'efectivo', montoCentavos: recibidoCentavos }]
    }

    setError(null)

    try {
      const cobrada = await caja.cobrar(lineas, pagos)

      setVenta(cobrada)
      setLineas([])
      setEstado(await caja.estado())
    } catch (causa) {
      setError(mensajeDeError(causa))
    }
  }

  function cambiarConteo(denominacion: Centavos, cantidad: number): void {
    setConteo((previo) => ({ ...previo, [denominacion]: cantidad }))
  }

  async function confirmarCierre(): Promise<void> {
    if (caja === null) return

    setError(null)

    try {
      const cierre = await caja.cerrarTurno(conteo)

      setUltimoCierre(cierre.arqueo)
      setPanelCierre(false)
      setConteo({})
      setLineas([])
      setEstado(await caja.estado())
    } catch (causa) {
      setError(mensajeDeError(causa))
    }
  }

  if (errorDeCarga !== null) {
    return (
      <main className="pos">
        <p className="pos__error" role="alert">
          No se pudo iniciar el POS: {errorDeCarga}
        </p>
      </main>
    )
  }

  if (caja === null || estado === null) {
    return (
      <main className="pos">
        <p className="pos__cargando">Cargando la caja…</p>
      </main>
    )
  }

  const arqueoEnCurso = armarArqueo({
    esperadoCentavos: estado.turno.fondoCentavos + estado.turno.cobradoPorMedio.efectivo,
    contadoCentavos: contarDenominaciones(conteo),
  })

  return (
    <div className="pos">
      <Encabezado
        nombreTenant={NOMBRE_TENANT}
        terminalId={TERMINAL_ID}
        turno={estado.turno}
        onCerrarCaja={() => setPanelCierre(true)}
      />

      {error !== null && (
        <p className="pos__error" role="alert">
          {error}
        </p>
      )}

      {!estado.turno.abierto && (
        <AperturaCaja fondoPorDefecto={FONDO_POR_DEFECTO} onAbrir={abrirTurno} />
      )}

      {estado.turno.abierto && (
        <div className="pos__paneles">
          <GrillaProductos
            productos={CATALOGO}
            stock={estado.stock}
            onAgregar={agregarProducto}
          />
          <PanelVenta
            lineas={lineas}
            totales={totales}
            efectivoPesos={efectivoPesos}
            esTarjeta={esTarjeta}
            onCambiarCantidad={cambiarCantidad}
            onCambiarEfectivo={setEfectivoPesos}
            onCambiarTarjeta={setEsTarjeta}
            onCobrar={cobrar}
          />
        </div>
      )}

      {panelCierre && estado.turno.abierto && (
        <PanelCierre
          denominaciones={DENOMINACIONES}
          conteo={conteo}
          arqueo={arqueoEnCurso}
          onCambiarCantidad={cambiarConteo}
          onConfirmar={confirmarCierre}
          onCancelar={() => setPanelCierre(false)}
        />
      )}

      {ultimoCierre !== null && (
        <section className="ultimo-cierre" aria-label="Último cierre">
          <h2 className="ultimo-cierre__titulo">Último cierre</h2>
          <ResumenArqueo arqueo={ultimoCierre} />
        </section>
      )}

      {venta !== null && (
        <Ticket venta={venta} nombreTenant={NOMBRE_TENANT} terminalId={TERMINAL_ID} />
      )}
    </div>
  )
}

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}
