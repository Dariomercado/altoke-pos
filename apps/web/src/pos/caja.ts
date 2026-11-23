/**
 * La caja del POS: traduce lo que hace el cajero en eventos del libro.
 *
 * Es el único lugar de la app que escribe eventos, y no calcula plata propia: los totales vienen de
 * `calcularTotales` y el estado de las proyecciones del dominio. El store es un puerto, así que la
 * misma caja funciona sobre IndexedDB (web real) y sobre memoria (tests).
 *
 * Reglas que esta capa impone, porque nadie más las puede imponer:
 *   - **No se cobra sin turno abierto.** Un kiosco abre la caja con fondo y cierra al final; sin
 *     turno no hay arqueo posible y el cierre de turno queda huérfano.
 *   - **No se confirma una venta mal cobrada.** Si los pagos no alcanzan el total, no se escribe
 *     nada: cobrar de menos es un error del cajero, no un estado del negocio.
 *   - **La secuencia es estrictamente creciente por terminal**, que es lo único que hace
 *     concatenable el libro entre terminales (`0001` §2). Se toma del libro, no de memoria, así
 *     que sobrevive a recargar la pestaña.
 *   - **El cambio sale sólo del efectivo**: con tarjeta no se da vuelto.
 */

import { arqueoDesdeTurno, proyeccionStock, proyeccionTurno, resumirTurno } from '@altoke/domain'
import type {
  Arqueo,
  Centavos,
  ConteoPorDenominacion,
  Evento,
  MedioPago,
  ResumenTurno,
  StockPorSku,
} from '@altoke/domain'
import type { PosStore } from '@altoke/store'
import { calcularTotales } from './venta'
import type { LineaDeVenta } from './venta'

type ClavesEnvoltorio =
  | 'id'
  | 'tenantId'
  | 'terminalId'
  | 'secuencia'
  | 'ocurridoEn'
  | 'schemaVersion'

/**
 * Cuerpo de un evento sin su envoltorio.
 *
 * `Evento` es `Envoltorio & (unión de tipos)` y `Omit` sobre una intersección deja sólo las claves
 * comunes a todas las ramas: hay que extraer cada rama por su `tipo` para no perder los campos
 * propios de cada evento.
 */
type CuerpoDeEvento = {
  [T in Evento['tipo']]: Omit<Extract<Evento, { readonly tipo: T }>, ClavesEnvoltorio>
}[Evento['tipo']]

export interface OpcionesCaja {
  readonly store: PosStore
  readonly tenantId: string
  readonly terminalId: string
  /** Inyectables para test: en la app son la hora del sistema y un UUID. */
  readonly ahora?: () => string
  readonly nuevoId?: () => string
}

export interface PagoSolicitado {
  readonly medio: MedioPago
  readonly montoCentavos: Centavos
}

export interface VentaCobrada {
  readonly ventaId: string
  readonly turnoId: string
  readonly lineas: readonly LineaDeVenta[]
  readonly totalCentavos: Centavos
  readonly ivaCentavos: Centavos
  readonly netoCentavos: Centavos
  readonly pagos: readonly PagoSolicitado[]
  readonly cambioCentavos: Centavos
  readonly ocurridoEn: string
}

export interface EstadoCaja {
  readonly turno: ResumenTurno
  readonly stock: StockPorSku
}

export interface CierreDeTurno {
  readonly resumen: ResumenTurno
  readonly arqueo: Arqueo
}

export interface Caja {
  abrirTurno(fondoCentavos: Centavos): Promise<void>
  cobrar(lineas: readonly LineaDeVenta[], pagos: readonly PagoSolicitado[]): Promise<VentaCobrada>
  anular(ventaId: string, motivo: string): Promise<void>
  cerrarTurno(conteo: ConteoPorDenominacion): Promise<CierreDeTurno>
  /** Carga el stock inicial si el libro está vacío. Devuelve si sembró. */
  sembrar(stock: Readonly<Record<string, number>>): Promise<boolean>
  estado(): Promise<EstadoCaja>
}

export function crearCaja(opciones: OpcionesCaja): Caja {
  const { store, tenantId, terminalId } = opciones
  const ahora = opciones.ahora ?? ((): string => new Date().toISOString())
  const nuevoId = opciones.nuevoId ?? ((): string => crypto.randomUUID())

  let siguienteSecuencia: number | null = null

  async function proximaSecuencia(): Promise<number> {
    if (siguienteSecuencia === null) {
      const libro = await store.leerDesde(terminalId, 0)
      siguienteSecuencia = (libro.at(-1)?.secuencia ?? 0) + 1
    }

    const actual = siguienteSecuencia
    siguienteSecuencia += 1
    return actual
  }

  function sobre(cuerpo: CuerpoDeEvento, secuencia: number): Evento {
    return {
      id: nuevoId(),
      tenantId,
      terminalId,
      secuencia,
      ocurridoEn: ahora(),
      schemaVersion: 1,
      ...cuerpo,
    } as Evento
  }

  async function evento(cuerpo: CuerpoDeEvento): Promise<Evento> {
    return sobre(cuerpo, await proximaSecuencia())
  }

  async function estadoTurno(): Promise<{ resumen: ResumenTurno; turnoId: string | null }> {
    const resumen = resumirTurno(await store.proyectar(proyeccionTurno()))

    return { resumen, turnoId: resumen.turnoId }
  }

  return {
    async abrirTurno(fondoCentavos: Centavos): Promise<void> {
      const { resumen } = await estadoTurno()

      if (resumen.abierto) {
        throw new Error('Ya hay un turno abierto: cerralo antes de abrir otro.')
      }

      await store.append([await evento({ tipo: 'turno_abierto', turnoId: nuevoId(), fondoCentavos })])
    },

    async cobrar(
      lineas: readonly LineaDeVenta[],
      pagos: readonly PagoSolicitado[],
    ): Promise<VentaCobrada> {
      if (lineas.length === 0) {
        throw new Error('La venta no tiene ítems.')
      }
      if (pagos.length === 0) {
        throw new Error('La venta no tiene pagos.')
      }

      const totales = calcularTotales(lineas)
      const cobradoCentavos = pagos.reduce((suma, pago) => suma + pago.montoCentavos, 0)

      if (cobradoCentavos < totales.totalCentavos) {
        throw new RangeError(
          `Faltan cobrar ${totales.totalCentavos - cobradoCentavos} centavos de ${totales.totalCentavos}`,
        )
      }

      const { turnoId } = await estadoTurno()
      if (turnoId === null) {
        throw new Error('No hay turno abierto: abrí la caja antes de cobrar.')
      }

      const ventaId = nuevoId()
      const ocurridoEn = ahora()
      const efectivoCentavos = pagos
        .filter((pago) => pago.medio === 'efectivo')
        .reduce((suma, pago) => suma + pago.montoCentavos, 0)

      const cuerpos: CuerpoDeEvento[] = [
        { tipo: 'venta_iniciada', ventaId, turnoId },
        ...lineas.map((linea) => cuerpoDeItem(ventaId, linea)),
        ...pagos.map((pago) => cuerpoDePago(ventaId, pago)),
        { tipo: 'venta_confirmada', ventaId, totalCentavos: totales.totalCentavos },
      ]

      const eventos: Evento[] = []
      for (const cuerpo of cuerpos) {
        eventos.push(await evento(cuerpo))
      }

      await store.append(eventos)

      return {
        ventaId,
        turnoId,
        lineas,
        totalCentavos: totales.totalCentavos,
        ivaCentavos: totales.ivaCentavos,
        netoCentavos: totales.netoCentavos,
        pagos,
        // Con tarjeta no se da vuelto: el cambio no puede superar el efectivo recibido.
        cambioCentavos: Math.min(cobradoCentavos - totales.totalCentavos, efectivoCentavos),
        ocurridoEn,
      }
    },

    async anular(ventaId: string, motivo: string): Promise<void> {
      if (motivo.trim() === '') {
        throw new Error('Anular una venta necesita un motivo.')
      }

      const turno = await store.proyectar(proyeccionTurno())
      const venta = turno.ventas[ventaId]

      if (venta === undefined) {
        throw new Error(`La venta ${ventaId} no está en el turno.`)
      }
      if (venta.estado !== 'confirmada') {
        throw new Error(`La venta ${ventaId} no está confirmada (${venta.estado}).`)
      }

      await store.append([await evento({ tipo: 'venta_anulada', ventaId, motivo })])
    },

    async cerrarTurno(conteo: ConteoPorDenominacion): Promise<CierreDeTurno> {
      const { resumen, turnoId } = await estadoTurno()

      if (!resumen.abierto || turnoId === null) {
        throw new Error('No hay turno abierto para cerrar.')
      }

      const arqueo = arqueoDesdeTurno(resumen, conteo)
      await store.append([
        await evento({ tipo: 'turno_cerrado', turnoId, declaradoCentavos: arqueo.contadoCentavos }),
      ])

      return { resumen, arqueo }
    },

    async sembrar(stock: Readonly<Record<string, number>>): Promise<boolean> {
      const libro = await store.leerDesde(terminalId, 0)
      if (libro.length > 0) return false

      const eventos: Evento[] = []

      for (const [sku, delta] of Object.entries(stock)) {
        eventos.push(await evento({ tipo: 'ajuste_stock', sku, delta, causa: 'inicial' }))
      }

      await store.append(eventos)
      return true
    },

    async estado(): Promise<EstadoCaja> {
      return {
        turno: resumirTurno(await store.proyectar(proyeccionTurno())),
        stock: await store.proyectar(proyeccionStock()),
      }
    },
  }
}

function cuerpoDeItem(ventaId: string, linea: LineaDeVenta): CuerpoDeEvento {
  return {
    tipo: 'item_agregado',
    ventaId,
    sku: linea.sku,
    cantidad: linea.cantidad,
    precioUnitarioCentavos: linea.precioUnitarioCentavos,
  }
}

function cuerpoDePago(ventaId: string, pago: PagoSolicitado): CuerpoDeEvento {
  return {
    tipo: 'pago_registrado',
    ventaId,
    medio: pago.medio,
    montoCentavos: pago.montoCentavos,
  }
}
