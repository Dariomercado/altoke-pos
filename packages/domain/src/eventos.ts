/**
 * Libro de eventos del POS (docs/specs/0001-arquitectura.md §2).
 *
 * Una venta no es una fila que se actualiza: es una secuencia de eventos inmutables. Todo lo
 * que la UI muestra —stock, total del turno— es una **proyección** recalculable desde cero.
 *
 * Tres funciones y nada más (el anti-patrón explícito del spec: sin aggregates, sin bus de
 * eventos, sin snapshotting por versión): `append` vive en el puerto `PosStore`, acá están
 * `leerDesde` y `proyectar`.
 *
 * Consecuencias que este archivo respeta:
 *   - Nadie escribe `UPDATE stock SET ...`. El stock es una proyección y puede quedar negativo:
 *     el kiosco vende el último alfajor sin saberlo y eso es un hecho, no un error (§3).
 *   - Una sobreventa se cuenta, no se corrige: `sobreventa_detectada` es informativa. Nomás el
 *     servidor la puede escribir, porque es el único que ve el libro de todas las terminales.
 *   - El total de una venta es el que se confirmó, no uno recalculado después: es el número que
 *     salió impreso en el ticket.
 *   - Los eventos se validan en el borde (§ puertos): IndexedDB devuelve datos que no son de
 *     fiar, y persistir un monto con centavos fraccionarios corrompe el arqueo para siempre.
 */

import { esCentavos } from './dinero.ts'
import type { Centavos } from './dinero.ts'

export const MEDIOS_PAGO = ['efectivo', 'tarjeta_manual', 'transferencia', 'qr'] as const
export type MedioPago = (typeof MEDIOS_PAGO)[number]

/**
 * La terminal reservada del servidor: sus eventos son los que ninguna caja presencia.
 *
 * La identidad del libro es `(tenant, terminal, secuencia)` y la secuencia es **por terminal**, así
 * que un evento de origen servidor necesita una terminal propia. `servidor` nunca es una caja: un
 * cliente no puede escribir con este id ni empujar los tipos de `TIPOS_DEL_SERVIDOR`.
 */
export const TERMINAL_DEL_SERVIDOR = 'servidor'

/**
 * Los tipos que sólo escribe el servidor.
 *
 * `sobreventa_detectada` nace de comparar el libro de **todas** las terminales de un tenant; una
 * caja sola no puede saber que otra vendió la última unidad antes que ella.
 */
export const TIPOS_DEL_SERVIDOR = ['sobreventa_detectada'] as const
export type TipoDelServidor = (typeof TIPOS_DEL_SERVIDOR)[number]

export function esTipoDelServidor(tipo: string): tipo is TipoDelServidor {
  return (TIPOS_DEL_SERVIDOR as readonly string[]).includes(tipo)
}

/** Lo que todo evento lleva, sin importar su tipo. */
interface Envoltorio {
  /** ULID. Opaco para el dominio: sólo tiene que ser único y no vacío. */
  readonly id: string
  readonly tenantId: string
  readonly terminalId: string
  /** Monotónica por terminal: es la cola de sync y el orden de reproducción. */
  readonly secuencia: number
  /** ISO-8601. */
  readonly ocurridoEn: string
  readonly schemaVersion: 1
}

export type Evento = Envoltorio &
  (
    | { readonly tipo: 'turno_abierto'; readonly turnoId: string; readonly fondoCentavos: Centavos }
    | { readonly tipo: 'venta_iniciada'; readonly ventaId: string; readonly turnoId: string }
    | {
        readonly tipo: 'item_agregado'
        readonly ventaId: string
        readonly sku: string
        readonly cantidad: number
        readonly precioUnitarioCentavos: Centavos
      }
    | { readonly tipo: 'item_quitado'; readonly ventaId: string; readonly sku: string; readonly cantidad: number }
    | {
        readonly tipo: 'item_devuelto'
        readonly ventaId: string
        readonly sku: string
        readonly cantidad: number
        readonly motivo: string
      }
    | {
        readonly tipo: 'descuento'
        readonly ventaId: string
        readonly montoCentavos: Centavos
        readonly motivo: string
      }
    | {
        readonly tipo: 'pago_registrado'
        readonly ventaId: string
        readonly medio: MedioPago
        readonly montoCentavos: Centavos
      }
    | { readonly tipo: 'venta_confirmada'; readonly ventaId: string; readonly totalCentavos: Centavos }
    | { readonly tipo: 'venta_anulada'; readonly ventaId: string; readonly motivo: string }
    | { readonly tipo: 'ajuste_stock'; readonly sku: string; readonly delta: number; readonly causa: string }
    | { readonly tipo: 'turno_cerrado'; readonly turnoId: string; readonly declaradoCentavos: Centavos }
    /**
     * Dos terminales vendieron la última unidad del mismo SKU (§3). Ambas ventas valen: la
     * mercadería salió. El evento nombra la venta, el SKU, cuántas unidades se vendieron y el stock
     * proyectado que quedó, para que la UI lo muestre como alerta. **Es informativo**: no mueve
     * ninguna proyección (ver `proyeccionSobreventas`).
     */
    | {
        readonly tipo: 'sobreventa_detectada'
        readonly ventaId: string
        readonly sku: string
        /** Unidades de ese SKU en la venta que dejó el stock bajo cero. */
        readonly cantidad: number
        /** El stock que resultó, negativo: es el número que el cajero tiene que ver. */
        readonly stockProyectado: number
      }
  )

/**
 * Cola de eventos de una terminal: lo posterior a la secuencia acusada, en orden.
 *
 * Es literalmente la cola de sync (§2, I2): eventos con secuencia mayor al último acuse.
 */
export function leerDesde(
  eventos: readonly Evento[],
  terminalId: string,
  despuesDeSecuencia: number,
): Evento[] {
  if (!Number.isInteger(despuesDeSecuencia) || despuesDeSecuencia < 0) {
    throw new RangeError(`Secuencia acusada inválida: ${despuesDeSecuencia}`)
  }

  return eventos
    .filter((evento) => evento.terminalId === terminalId && evento.secuencia > despuesDeSecuencia)
    .sort((a, b) => a.secuencia - b.secuencia)
}

/** Un reductor puro: el estado siguiente no comparte nada con el anterior. */
export interface Proyeccion<T> {
  readonly inicial: T
  aplicar(estado: T, evento: Evento): T
}

export function proyectar<T>(eventos: readonly Evento[], proyeccion: Proyeccion<T>): T {
  let estado = proyeccion.inicial

  for (const evento of eventos) {
    estado = proyeccion.aplicar(estado, evento)
  }

  return estado
}

export type StockPorSku = Readonly<Record<string, number>>

/**
 * Stock por SKU derivado del libro.
 *
 * Lo vendido descuenta, lo quitado y lo devuelto reponen, y `ajuste_stock` aplica su delta
 * (inventario inicial, compra, merma). El resultado puede ser negativo a propósito.
 */
export function proyeccionStock(): Proyeccion<StockPorSku> {
  return {
    inicial: {},
    aplicar(estado, evento) {
      switch (evento.tipo) {
        case 'ajuste_stock':
          return mover(estado, evento.sku, evento.delta)
        case 'item_agregado':
          return mover(estado, evento.sku, -evento.cantidad)
        case 'item_quitado':
        case 'item_devuelto':
          return mover(estado, evento.sku, evento.cantidad)
        case 'sobreventa_detectada':
          // Informativa: el stock ya era negativo (o lo hizo este ítem) y el evento sólo lo cuenta.
          return estado
        default:
          return estado
      }
    },
  }
}

export interface Sobreventa {
  readonly ventaId: string
  readonly sku: string
  readonly cantidad: number
  readonly stockProyectado: number
}

/** Las alertas de sobreventa, por venta y por SKU: una entrada es un hecho, no un aviso repetido. */
export type SobreventasPorVenta = Readonly<
  Record<string, Readonly<Record<string, Sobreventa>>>
>

/**
 * Alertas de sobreventa que el POS muestra (0003 §Sobreventa).
 *
 * **Aplicar el mismo evento dos veces no agrega nada**: un cliente que trae dos veces la misma
 * página del servidor, o que relee su propio libro, no puede terminar con la alerta duplicada. Por
 * eso el estado es un mapa por `(venta, SKU)` y no una lista, y un hecho idéntico devuelve el mismo
 * estado. Un hecho distinto para el mismo `(venta, SKU)` gana el último: en un libro ordenado esa es
 * la última palabra.
 */
export function proyeccionSobreventas(): Proyeccion<SobreventasPorVenta> {
  return {
    inicial: {},
    aplicar(estado, evento) {
      if (evento.tipo !== 'sobreventa_detectada') return estado

      const deLaVenta = estado[evento.ventaId] ?? {}
      const previa = deLaVenta[evento.sku]
      if (
        previa !== undefined &&
        previa.cantidad === evento.cantidad &&
        previa.stockProyectado === evento.stockProyectado
      ) {
        return estado
      }

      return {
        ...estado,
        [evento.ventaId]: {
          ...deLaVenta,
          [evento.sku]: {
            ventaId: evento.ventaId,
            sku: evento.sku,
            cantidad: evento.cantidad,
            stockProyectado: evento.stockProyectado,
          },
        },
      }
    },
  }
}

function mover(estado: StockPorSku, sku: string, delta: number): StockPorSku {
  return { ...estado, [sku]: (estado[sku] ?? 0) + delta }
}

export type EstadoVenta = 'iniciada' | 'confirmada' | 'anulada'

export interface PagoRegistrado {
  readonly medio: MedioPago
  readonly montoCentavos: Centavos
}

export interface VentaEnTurno {
  readonly ventaId: string
  readonly estado: EstadoVenta
  readonly items: Readonly<Record<string, number>>
  /** El total confirmado: lo que salió impreso, con el descuento ya aplicado. */
  readonly totalCentavos: Centavos
  readonly pagos: readonly PagoRegistrado[]
  readonly motivoAnulacion: string | null
}

export interface EstadoTurno {
  readonly turnoId: string | null
  readonly abierto: boolean
  readonly fondoCentavos: Centavos
  /** Lo que el cajero contó al cerrar; la comparación vive en el arqueo. */
  readonly declaradoCentavos: Centavos | null
  readonly ventas: Readonly<Record<string, VentaEnTurno>>
}

const TURNO_VACIO: EstadoTurno = {
  turnoId: null,
  abierto: false,
  fondoCentavos: 0,
  declaradoCentavos: null,
  ventas: {},
}

/**
 * Turno en curso. Un evento que apunta a una venta que la proyección no conoce se ignora: esta
 * proyección resume, no valida la coherencia del libro.
 */
export function proyeccionTurno(): Proyeccion<EstadoTurno> {
  return {
    inicial: TURNO_VACIO,
    aplicar(estado, evento) {
      switch (evento.tipo) {
        case 'turno_abierto':
          return {
            turnoId: evento.turnoId,
            abierto: true,
            fondoCentavos: evento.fondoCentavos,
            declaradoCentavos: null,
            ventas: {},
          }
        case 'venta_iniciada':
          return {
            ...estado,
            ventas: {
              ...estado.ventas,
              [evento.ventaId]: {
                ventaId: evento.ventaId,
                estado: 'iniciada',
                items: {},
                totalCentavos: 0,
                pagos: [],
                motivoAnulacion: null,
              },
            },
          }
        case 'item_agregado':
          return conVenta(estado, evento.ventaId, (venta) => ({
            ...venta,
            items: { ...venta.items, [evento.sku]: (venta.items[evento.sku] ?? 0) + evento.cantidad },
          }))
        case 'item_quitado':
        case 'item_devuelto':
          return conVenta(estado, evento.ventaId, (venta) => ({
            ...venta,
            items: sumarItem(venta.items, evento.sku, -evento.cantidad),
          }))
        case 'pago_registrado':
          return conVenta(estado, evento.ventaId, (venta) => ({
            ...venta,
            pagos: [...venta.pagos, { medio: evento.medio, montoCentavos: evento.montoCentavos }],
          }))
        case 'venta_confirmada':
          return conVenta(estado, evento.ventaId, (venta) => ({
            ...venta,
            estado: 'confirmada',
            totalCentavos: evento.totalCentavos,
          }))
        case 'venta_anulada':
          return conVenta(estado, evento.ventaId, (venta) => ({
            ...venta,
            estado: 'anulada',
            motivoAnulacion: evento.motivo,
          }))
        case 'turno_cerrado':
          return { ...estado, abierto: false, declaradoCentavos: evento.declaradoCentavos }
        case 'sobreventa_detectada':
          // Informativa: una alerta no cambia el arqueo ni la venta que ya se cobró.
          return estado
        default:
          return estado
      }
    },
  }
}

function conVenta(
  estado: EstadoTurno,
  ventaId: string,
  cambiar: (venta: VentaEnTurno) => VentaEnTurno,
): EstadoTurno {
  const venta = estado.ventas[ventaId]
  if (venta === undefined) return estado

  return { ...estado, ventas: { ...estado.ventas, [ventaId]: cambiar(venta) } }
}

function sumarItem(
  items: Readonly<Record<string, number>>,
  sku: string,
  delta: number,
): Readonly<Record<string, number>> {
  return { ...items, [sku]: (items[sku] ?? 0) + delta }
}

export interface ResumenTurno {
  readonly turnoId: string | null
  readonly abierto: boolean
  readonly fondoCentavos: Centavos
  readonly declaradoCentavos: Centavos | null
  readonly ventasConfirmadas: number
  readonly ventasAnuladas: number
  /** Suma de las ventas confirmadas vivas. */
  readonly totalCentavos: Centavos
  /** Suma de los pagos de esas ventas. */
  readonly cobradoCentavos: Centavos
  readonly cobradoPorMedio: Readonly<Record<MedioPago, Centavos>>
  /** `cobrado − total`. Cero es lo esperado; negativo, plata que quedó sin cobrar. */
  readonly diferenciaCentavos: Centavos
  readonly unidadesPorSku: Readonly<Record<string, number>>
}

/**
 * Resumen de caja del turno.
 *
 * Una venta anulada no suma ni al total ni a lo cobrado, y sus pagos salen del arqueo: si el
 * cliente se fue con la plata devuelta, esa plata no está en el cajón.
 */
export function resumirTurno(estado: EstadoTurno): ResumenTurno {
  const cobradoPorMedio: Record<MedioPago, Centavos> = {
    efectivo: 0,
    tarjeta_manual: 0,
    transferencia: 0,
    qr: 0,
  }
  const unidadesPorSku: Record<string, number> = {}

  let ventasConfirmadas = 0
  let ventasAnuladas = 0
  let totalCentavos = 0
  let cobradoCentavos = 0

  for (const venta of Object.values(estado.ventas)) {
    if (venta.estado === 'anulada') {
      ventasAnuladas += 1
      continue
    }

    for (const [sku, cantidad] of Object.entries(venta.items)) {
      unidadesPorSku[sku] = (unidadesPorSku[sku] ?? 0) + cantidad
    }

    if (venta.estado !== 'confirmada') continue

    ventasConfirmadas += 1
    totalCentavos += venta.totalCentavos

    for (const pago of venta.pagos) {
      cobradoPorMedio[pago.medio] += pago.montoCentavos
      cobradoCentavos += pago.montoCentavos
    }
  }

  return {
    turnoId: estado.turnoId,
    abierto: estado.abierto,
    fondoCentavos: estado.fondoCentavos,
    declaradoCentavos: estado.declaradoCentavos,
    ventasConfirmadas,
    ventasAnuladas,
    totalCentavos,
    cobradoCentavos,
    cobradoPorMedio,
    diferenciaCentavos: cobradoCentavos - totalCentavos,
    unidadesPorSku,
  }
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== ''
}

function exigirTexto(valor: unknown, campo: string): void {
  if (!textoNoVacio(valor)) throw new TypeError(`${campo} debe ser un texto no vacío: ${String(valor)}`)
}

function exigirEnteroPositivo(valor: unknown, campo: string): void {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) {
    throw new RangeError(`${campo} debe ser un entero positivo: ${String(valor)}`)
  }
}

function exigirCentavos(valor: unknown, campo: string): void {
  if (!esCentavos(valor)) {
    throw new RangeError(`${campo} debe ser centavos enteros no negativos: ${String(valor)}`)
  }
}

function exigirMedio(valor: unknown): void {
  if (!(MEDIOS_PAGO as readonly unknown[]).includes(valor)) {
    throw new RangeError(`Medio de pago desconocido: ${String(valor)}`)
  }
}

function exigirEntero(valor: unknown, campo: string): void {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    throw new RangeError(`${campo} debe ser un entero: ${String(valor)}`)
  }
}

/**
 * Valida un evento que llega de afuera (IndexedDB, un import, un formulario).
 *
 * Un evento inválido que entra al libro no se puede distinguir después de un evento raro pero
 * legítimo: el arqueo queda mal para siempre y sin rastro del culpable.
 */
export function validarEvento(evento: Evento): void {
  exigirTexto(evento.id, 'id')
  exigirTexto(evento.tenantId, 'tenantId')
  exigirTexto(evento.terminalId, 'terminalId')

  if (!Number.isInteger(evento.secuencia) || evento.secuencia <= 0) {
    throw new RangeError(`secuencia debe ser un entero positivo: ${String(evento.secuencia)}`)
  }

  if (typeof evento.ocurridoEn !== 'string' || Number.isNaN(new Date(evento.ocurridoEn).getTime())) {
    throw new TypeError(`ocurridoEn debe ser una fecha ISO-8601: ${String(evento.ocurridoEn)}`)
  }

  if (evento.schemaVersion !== 1) {
    throw new RangeError(`schemaVersion no soportada: ${String(evento.schemaVersion)}`)
  }

  switch (evento.tipo) {
    case 'turno_abierto':
      exigirTexto(evento.turnoId, 'turnoId')
      exigirCentavos(evento.fondoCentavos, 'fondoCentavos')
      return
    case 'venta_iniciada':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.turnoId, 'turnoId')
      return
    case 'item_agregado':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.sku, 'sku')
      exigirEnteroPositivo(evento.cantidad, 'cantidad')
      exigirCentavos(evento.precioUnitarioCentavos, 'precioUnitarioCentavos')
      return
    case 'item_quitado':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.sku, 'sku')
      exigirEnteroPositivo(evento.cantidad, 'cantidad')
      return
    case 'item_devuelto':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.sku, 'sku')
      exigirEnteroPositivo(evento.cantidad, 'cantidad')
      exigirTexto(evento.motivo, 'motivo')
      return
    case 'descuento':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirCentavos(evento.montoCentavos, 'montoCentavos')
      exigirTexto(evento.motivo, 'motivo')
      return
    case 'pago_registrado':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirMedio(evento.medio)
      exigirCentavos(evento.montoCentavos, 'montoCentavos')
      return
    case 'venta_confirmada':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirCentavos(evento.totalCentavos, 'totalCentavos')
      return
    case 'venta_anulada':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.motivo, 'motivo')
      return
    case 'ajuste_stock':
      exigirTexto(evento.sku, 'sku')
      if (!Number.isInteger(evento.delta)) {
        throw new RangeError(`delta debe ser un entero: ${String(evento.delta)}`)
      }
      exigirTexto(evento.causa, 'causa')
      return
    case 'turno_cerrado':
      exigirTexto(evento.turnoId, 'turnoId')
      exigirCentavos(evento.declaradoCentavos, 'declaradoCentavos')
      return
    case 'sobreventa_detectada':
      exigirTexto(evento.ventaId, 'ventaId')
      exigirTexto(evento.sku, 'sku')
      exigirEnteroPositivo(evento.cantidad, 'cantidad')
      exigirEntero(evento.stockProyectado, 'stockProyectado')
      // Una sobreventa deja el stock bajo cero: un evento que dice otra cosa está mintiendo sobre
      // el único número que el cajero va a leer.
      if (evento.stockProyectado >= 0) {
        throw new RangeError(`stockProyectado debe ser negativo: ${String(evento.stockProyectado)}`)
      }
      return
    default:
      throw new RangeError(`Tipo de evento desconocido: ${String((evento as { tipo?: unknown }).tipo)}`)
  }
}

/**
 * El borde del cliente: `validarEvento` más las dos reglas de origen.
 *
 * La caja escribe lo que presenció. Un `sobreventa_detectada` nace de comparar el libro de todas las
 * terminales del tenant, y la terminal `servidor` es la identidad reservada para esos eventos
 * (`0001` §3, `0003` §Sobreventa). Aceptarlos del cliente dejaría que una terminal invente alertas
 * —o que se haga pasar por el servidor— sin que nadie pueda distinguirlo después.
 */
export function validarEventoDeCliente(evento: Evento): void {
  validarEvento(evento)

  if (evento.terminalId === TERMINAL_DEL_SERVIDOR) {
    throw new RangeError(
      `terminalId "${TERMINAL_DEL_SERVIDOR}" está reservado para los eventos del servidor.`,
    )
  }

  if (esTipoDelServidor(evento.tipo)) {
    throw new RangeError(
      `El cliente no puede escribir un evento ${evento.tipo}: lo emite el servidor.`,
    )
  }
}
