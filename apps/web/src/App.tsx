/**
 * Pantalla del POS (T4): bandeja táctil —riel de categorías, grilla de productos y bandeja de
 * venta anclada abajo— sobre `PanelVenta`, con el cobro al alcance del pulgar. El cobro en sí
 * (T5) es la hoja que sube sobre esta pantalla.
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
import type { MarcaTenant } from '@altoke/ui'
import { CATALOGO, STOCK_INICIAL } from './catalogo'
import type { ProductoDeCatalogo } from './catalogo'
import { AperturaCaja } from './components/AperturaCaja'
import { Encabezado } from './components/Encabezado'
import { PanelCierre } from './components/PanelCierre'
import { PanelMarca } from './components/PanelMarca'
import { ResumenArqueo } from './components/ResumenArqueo'
import { Ticket } from './components/Ticket'
import { HojaCobro } from './components/bandeja/HojaCobro'
import { PantallaVenta } from './components/bandeja/PantallaVenta'
import { centavosDesdePesos, pesosDesdeCentavos } from './formato'
import { MARCA_INICIAL, aplicarMarca, cargarMarca, guardarMarca } from './marca'
import { crearCaja } from './pos/caja'
import type { Caja, EstadoCaja, PagoSolicitado, VentaCobrada } from './pos/caja'
import { calcularTotales } from './pos/venta'
import type { LineaDeVenta } from './pos/venta'

/**
 * Tenant del demo: el mismo id nombra la base local, los eventos y la marca guardada, porque la
 * base local contiene sólo su tenant y se purga al cerrar sesión (`0001` §6). El día que haya alta
 * de tenants, este id se deriva de la sesión y no se escribe a mano.
 */
export const TENANT_ID = 'kiosco-1'
export const NOMBRE_BASE = `altoke-${TENANT_ID}`
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
  const [hojaCobro, setHojaCobro] = useState(false)

  const [panelCierre, setPanelCierre] = useState(false)
  const [conteo, setConteo] = useState<ConteoPorDenominacion>({})
  const [ultimoCierre, setUltimoCierre] = useState<Arqueo | null>(null)

  const [marca, setMarca] = useState<MarcaTenant>(() => cargarMarca(TENANT_ID))
  const [panelMarca, setPanelMarca] = useState(false)

  // La marca se aplica sobre la raíz y no sobre un componente: los tokens bañan el POS y el ticket
  // a la vez, que es justo el contrato de las cinco variables (`0001` §7).
  useEffect(() => {
    aplicarMarca(marca)
  }, [marca])

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

  // Sin líneas no hay nada que cobrar: si la venta se vacía (o la cobra la caja) la hoja se va.
  useEffect(() => {
    if (lineas.length === 0) setHojaCobro(false)
  }, [lineas.length])

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

  /** Sacar la línea entera: la venta sigue abierta, sólo deja de incluir ese producto. */
  const quitarLinea = useCallback((sku: string) => {
    setLineas((previas) => previas.filter((linea) => linea.sku !== sku))
  }, [])

  const vaciarVenta = useCallback(() => {
    setLineas([])
  }, [])

  /**
   * COBRAR abre la hoja de cobro; la venta todavía no se escribió. Una venta vacía no la abre:
   * no hay medio de pago que elegir ni total que cubrir.
   */
  const abrirCobro = useCallback(() => {
    if (lineas.length === 0) return

    setError(null)
    setHojaCobro(true)
  }, [lineas.length])

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

  /** Una marca aceptada se aplica y se persiste: el tenant la encuentra al recargar la pestaña. */
  function aceptarMarca(nueva: MarcaTenant): void {
    guardarMarca(TENANT_ID, nueva)
    setMarca(nueva)
  }

  function restablecerMarca(): void {
    aceptarMarca(MARCA_INICIAL)
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

  const abierto = estado.turno.abierto

  return (
    <div className={abierto ? 'flex min-h-dvh flex-col' : 'pos'}>
      <Encabezado
        nombreTenant={NOMBRE_TENANT}
        terminalId={TERMINAL_ID}
        turno={estado.turno}
        onAbrirMarca={() => setPanelMarca(true)}
        onCerrarCaja={() => setPanelCierre(true)}
        logoUrl={marca.logoUrl}
      />

      {/*
       * Con el cierre abierto el aviso viaja adentro de esa capa: es la única visible, así que
       * repetirlo arriba dejaría el error tapado o duplicado en el árbol.
       */}
      {error !== null && !panelCierre && (
        <p
          className={
            abierto ? 'pos__error mx-[var(--page-margin)] my-[var(--space-sm)]' : 'pos__error'
          }
          role="alert"
        >
          {error}
        </p>
      )}

      {!abierto && <AperturaCaja fondoPorDefecto={FONDO_POR_DEFECTO} onAbrir={abrirTurno} />}

      {abierto && (
        <>
          <div className="h-[calc(100dvh-var(--size-header))] shrink-0">
            <PantallaVenta
              productos={CATALOGO}
              stock={estado.stock}
              onAgregar={agregarProducto}
              lineas={lineas}
              totales={totales}
              onCambiarCantidad={cambiarCantidad}
              onQuitar={quitarLinea}
              onVaciar={vaciarVenta}
              onCobrar={abrirCobro}
            />
          </div>

          {/*
           * La hoja de cobro sube sobre la venta y sobrevive cerrada: sus controles no se
           * desmontan, así el cajero vuelve a la venta sin perder lo que había elegido.
           */}
          <HojaCobro
            abierta={hojaCobro}
            lineas={lineas}
            totales={totales}
            efectivoPesos={efectivoPesos}
            esTarjeta={esTarjeta}
            onCambiarEfectivo={setEfectivoPesos}
            onElegirTarjeta={setEsTarjeta}
            onConfirmar={cobrar}
            onCerrar={() => setHojaCobro(false)}
          />
        </>
      )}

      {/*
       * Marca y ticket siguen con `pos.css`: en el turno abierto van apilados debajo de la
       * bandeja, con el margen de página que antes ponía `.pos`.
       */}
      <div
        className={
          abierto
            ? 'flex flex-col gap-[var(--space-md)] px-[var(--page-margin)] pb-[var(--space-lg)]'
            : 'contents'
        }
      >
        {panelMarca && (
          <PanelMarca
            marca={marca}
            nombreTenant={NOMBRE_TENANT}
            onCambiar={aceptarMarca}
            onRestablecer={restablecerMarca}
            onCerrar={() => setPanelMarca(false)}
          />
        )}

        {ultimoCierre !== null && (
          <section className="ultimo-cierre" aria-label="Último cierre">
            <h2 className="ultimo-cierre__titulo">Último cierre</h2>
            <ResumenArqueo arqueo={ultimoCierre} />
          </section>
        )}

        {venta !== null && (
          <Ticket
            venta={venta}
            nombreTenant={NOMBRE_TENANT}
            terminalId={TERMINAL_ID}
            logoUrl={marca.logoUrl}
          />
        )}
      </div>

      {/*
       * El cierre (T7) es una pantalla, no un panel al costado de la venta: cuenta billete por
       * billete en 1280×800 y deja el veredicto y las acciones al alcance del pulgar, así que vive
       * en su propia capa (`fixed inset-0`) y no en el flujo de la bandeja.
       */}
      {panelCierre && estado.turno.abierto && (
        <PanelCierre
          denominaciones={DENOMINACIONES}
          conteo={conteo}
          arqueo={arqueoEnCurso}
          turno={estado.turno}
          error={error}
          onCambiarCantidad={cambiarConteo}
          onVaciar={() => setConteo({})}
          onConfirmar={confirmarCierre}
          onCancelar={() => setPanelCierre(false)}
        />
      )}
    </div>
  )
}

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa)
}
