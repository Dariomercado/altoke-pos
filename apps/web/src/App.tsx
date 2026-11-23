/**
 * Pantalla del POS (T4): bandeja táctil —riel de categorías, grilla de productos y bandeja de
 * venta anclada abajo— sobre `PanelVenta`, con el cobro al alcance del pulgar. El cobro en sí
 * (T5) es la hoja que sube sobre esta pantalla.
 *
 * Esta capa **no calcula plata**: los totales vienen de `calcularTotales`, el stock proyectado y
 * el resumen del turno del libro, y el arqueo de `armarArqueo`. Todo lo que escribe eventos pasa
 * por la caja (`crearCaja`), que es la única que conoce las reglas del turno.
 *
 * T10 le agregó arriba dos capas que no calculan plata tampoco: la sesión (login, alta, selector
 * de tenant y roles) y el sync (un chip que reporta y un banner de sobreventa que no bloquea).
 * La venta sigue escrita en el libro local antes de que cualquiera de las dos se entere.
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
import { motion } from 'motion/react'
import { CATALOGO, STOCK_INICIAL } from './catalogo'
import type { ProductoDeCatalogo } from './catalogo'
import { AperturaCaja } from './components/AperturaCaja'
import { Encabezado } from './components/Encabezado'
import { PanelCierre } from './components/PanelCierre'
import { PanelMarca } from './components/PanelMarca'
import { ResumenArqueo } from './components/ResumenArqueo'
import { HojaCobro } from './components/bandeja/HojaCobro'
import { PantallaTicket } from './components/bandeja/PantallaTicket'
import { PantallaVenta } from './components/bandeja/PantallaVenta'
import { AvisoSobreventas } from './components/sesion/AvisoSobreventas'
import { FlujoDeAcceso } from './components/sesion/FlujoDeAcceso'
import { PantallaCargando } from './components/sesion/PantallaCargando'
import { SelectorTenant } from './components/sesion/SelectorTenant'
import { centavosDesdePesos, pesosDesdeCentavos } from './formato'
import { MARCA_INICIAL, aplicarMarca, cargarMarca, guardarMarca } from './marca'
import { entrada, useMovimiento } from './movimiento'
import { crearCaja } from './pos/caja'
import type { Caja, EstadoCaja, PagoSolicitado, VentaCobrada } from './pos/caja'
import { calcularTotales } from './pos/venta'
import type { LineaDeVenta } from './pos/venta'
import { crearDependenciasDeSesion, puede, useSesion, useSincronizacion } from './sesion'
import type {
  OpcionesSesionApp,
  OpcionesSincronizacionApp,
  SesionActiva,
} from './sesion'
import { nombreDeBaseDelTenant } from './sync'

export const TERMINAL_ID = 'terminal-1'

/** Fondo con el que arranca el demo: 50 pesos, lo que suele haber en un cajón chico. */
const FONDO_POR_DEFECTO = 5000

export interface AppProps {
  /** Inyectable para tests; en el navegador se usa IndexedDB. */
  readonly store?: PosStore
  /**
   * Inyectable para tests (y para el arranque ya resuelto): una sesión salta la lectura del
   * almacén, `null` es "sin sesión" explícito y omitirla arranca desde IndexedDB + `/auth/yo`.
   */
  readonly sesionInicial?: SesionActiva | null
  /** Adaptadores del módulo de sesión (almacén, cliente HTTP, purga). */
  readonly sesion?: OpcionesSesionApp
  /** Adaptadores del sync (transporte, acuses, intervalo). */
  readonly sync?: OpcionesSincronizacionApp
}

export function App({ store, sesionInicial, sesion, sync }: AppProps) {
  const dependencias = useMemo(
    () => crearDependenciasDeSesion(sesion),
    [sesion?.almacen, sesion?.cliente, sesion?.purgar, sesion?.baseUrl, sesion?.fetch],
  )

  const { estado, acciones } = useSesion({
    almacen: dependencias.almacen,
    cliente: dependencias.cliente,
    purgar: dependencias.purgar,
    inicial: sesionInicial,
  })

  switch (estado.tipo) {
    case 'cargando':
      return <PantallaCargando />

    case 'sin_sesion':
      return (
        <FlujoDeAcceso
          aviso={estado.aviso}
          onEntrar={acciones.iniciarSesion}
          onRegistrar={acciones.registrar}
        />
      )

    case 'eligiendo':
      return (
        <SelectorTenant
          usuario={estado.usuario}
          membresias={estado.membresias}
          onElegir={acciones.elegirTenant}
          onSalir={acciones.cerrarSesion}
        />
      )

    case 'activa':
      return (
        <PantallaPos
          sesion={estado.sesion}
          store={store}
          sync={sync}
          onSalir={acciones.cerrarSesion}
        />
      )
  }
}

interface PantallaPosProps {
  readonly sesion: SesionActiva
  readonly store?: PosStore | undefined
  readonly sync?: OpcionesSincronizacionApp | undefined
  readonly onSalir: () => Promise<void>
}

function PantallaPos({ sesion, store, sync, onSalir }: PantallaPosProps) {
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

  const [marca, setMarca] = useState<MarcaTenant>(() => cargarMarca(sesion.tenant.id))
  const [panelMarca, setPanelMarca] = useState(false)

  const puedeCobrar = puede(sesion.rol, 'cobrar')
  const puedeCerrar = puede(sesion.rol, 'cerrar_caja')
  const puedeMarca = puede(sesion.rol, 'administrar_marca')

  // M1: entrar a la venta es el primer momento animado (T8, `movimiento.ts`).
  const conMovimiento = useMovimiento()

  // Una base por tenant: el id sale de la sesión, no de una constante de demo (`0001` §6).
  const storeFinal = useMemo(
    () =>
      store ??
      crearIndexedDbStore({
        indexedDB: globalThis.indexedDB,
        nombreDb: nombreDeBaseDelTenant(sesion.tenant.id),
      }),
    [store, sesion.tenant.id],
  )

  const { instantanea, sincronizarAhora } = useSincronizacion({
    store: storeFinal,
    sesion,
    terminalId: TERMINAL_ID,
    ...(sync ?? {}),
  })

  // La marca se aplica sobre la raíz y no sobre un componente: los tokens bañan el POS y el ticket
  // a la vez, que es justo el contrato de las cinco variables (`0001` §7).
  useEffect(() => {
    aplicarMarca(marca)
  }, [marca])

  // Cambiar de tenant —o entrar después de un cierre de sesión— recarga la marca de ese kiosco.
  useEffect(() => {
    setMarca(cargarMarca(sesion.tenant.id))
  }, [sesion.tenant.id])

  useEffect(() => {
    let vigente = true
    setCaja(null)
    setEstado(null)
    setErrorDeCarga(null)
    setPanelCierre(false)
    setHojaCobro(false)

    const cajaNueva = crearCaja({
      store: storeFinal,
      tenantId: sesion.tenant.id,
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
  }, [storeFinal, sesion.tenant.id])

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
   * no hay medio de pago que elegir ni total que cubrir. El rol se mira acá y no sólo en el
   * botón: esconder COBRAR es una pista, no el permiso.
   */
  const abrirCobro = useCallback(() => {
    if (!puedeCobrar) {
      setError('Tu rol es de sólo lectura: no podés cobrar.')
      return
    }
    if (lineas.length === 0) return

    setError(null)
    setHojaCobro(true)
  }, [lineas.length, puedeCobrar])

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
    if (!puedeCobrar) {
      setError('Tu rol es de sólo lectura: no podés cobrar.')
      return
    }

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
      // La venta ya está confirmada en el libro: recién acá el sync puede empujarla. No se espera.
      sincronizarAhora()
    } catch (causa) {
      setError(mensajeDeError(causa))
    }
  }

  function cambiarConteo(denominacion: Centavos, cantidad: number): void {
    setConteo((previo) => ({ ...previo, [denominacion]: cantidad }))
  }

  function abrirMarca(): void {
    if (!puedeMarca) {
      setError('Tu rol no puede administrar la marca del kiosco.')
      return
    }

    setPanelMarca(true)
  }

  /** Una marca aceptada se aplica y se persiste: el tenant la encuentra al recargar la pestaña. */
  function aceptarMarca(nueva: MarcaTenant): void {
    if (!puedeMarca) {
      setError('Tu rol no puede administrar la marca del kiosco.')
      return
    }

    guardarMarca(sesion.tenant.id, nueva)
    setMarca(nueva)
  }

  function restablecerMarca(): void {
    aceptarMarca(MARCA_INICIAL)
  }

  function abrirCierre(): void {
    if (!puedeCerrar) {
      setError('Tu rol es de sólo lectura: no podés cerrar el turno.')
      return
    }

    setPanelCierre(true)
  }

  async function confirmarCierre(): Promise<void> {
    if (caja === null) return
    if (!puedeCerrar) {
      setError('Tu rol es de sólo lectura: no podés cerrar el turno.')
      return
    }

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
        nombreTenant={sesion.tenant.nombre}
        terminalId={TERMINAL_ID}
        turno={estado.turno}
        estadoSync={instantanea.estado}
        rol={sesion.rol}
        puedeAdministrarMarca={puedeMarca}
        puedeCerrarCaja={puedeCerrar}
        onAbrirMarca={abrirMarca}
        onCerrarCaja={abrirCierre}
        onSalir={() => {
          void onSalir()
        }}
        logoUrl={marca.logoUrl}
      />

      <AvisoSobreventas alertas={instantanea.alertas} />

      {/*
       * Con el cierre o la hoja de cobro abiertos el aviso viaja adentro de esa capa: es la única
       * visible, así que repetirlo arriba dejaría el error tapado o duplicado en el árbol.
       */}
      {error !== null && !panelCierre && !hojaCobro && (
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
          <motion.div
            {...entrada(conMovimiento, { desde: 'abajo' })}
            className={`grid h-[calc(100dvh-var(--size-header))] shrink-0 grid-rows-[minmax(0,1fr)] ${
              puedeCobrar ? '' : 'pos--solo-lectura'
            }`}
          >
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
          </motion.div>

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
            error={error}
            onCambiarEfectivo={setEfectivoPesos}
            onElegirTarjeta={setEsTarjeta}
            onConfirmar={cobrar}
            onCerrar={() => setHojaCobro(false)}
          />
        </>
      )}

      {/*
       * Marca y último cierre siguen con `pos.css`: en el turno abierto van apilados debajo de la
       * bandeja, con el margen de página que antes ponía `.pos`. El ticket ya no vive acá: cobrar
       * abre su propia pantalla (T6).
       *
       * El bloque no existe mientras no tenga nada adentro: un contenedor vacío con padding deja
       * una franja debajo de la bandeja y arrastra la página 40 px más abajo del viewport.
       */}
      {(panelMarca || ultimoCierre !== null) && (
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
              nombreTenant={sesion.tenant.nombre}
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
        </div>
      )}

      {/*
       * El ticket (T6) se queda en pantalla hasta que el cajero lo entrega: es la confirmación de
       * que la venta está en el libro y el vuelto que tiene que dar. Cerrarla es "Nueva venta".
       */}
      {venta !== null && (
        <PantallaTicket
          venta={venta}
          nombreTenant={sesion.tenant.nombre}
          terminalId={TERMINAL_ID}
          logoUrl={marca.logoUrl}
          onNuevaVenta={() => setVenta(null)}
        />
      )}

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
