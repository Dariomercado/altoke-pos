/**
 * Outbox fiscal (docs/specs/0002-fiscal-y-cobros.md §4, docs/specs/0003-api-y-sync.md §Outbox
 * fiscal).
 *
 * Una venta se confirma local e inmediatamente; el comprobante es un **efecto externo** y vive en
 * un outbox con sus propios estados. Regla dura que este archivo hace posible: **nunca se pierde
 * una venta por un problema fiscal**; una venta sin comprobante es una venta válida con deuda
 * documental.
 *
 * En M2 (F0) el outbox se construye **vacío**, y esto es la razón por la que existe hoy: agregarlo
 * después obliga a tocar el camino del cobro, que es lo único que no se toca con clientes
 * cobrando. Acá está la parte pura, sin IO: qué estados existen, qué transiciones son válidas,
 * cuándo un reintento está vencido y cómo se ve el primer intento. Quien escribe en la base es el
 * borde (el API, en M3/M4).
 *
 * Las transiciones son las del spec, ni más ni menos:
 *
 *     pendiente ──▶ emitido | fallido
 *     fallido   ──▶ pendiente            (reintento programado)
 *
 * `emitido` es final: la corrección de un comprobante es una **nota de crédito**, otro documento
 * que apunta al anterior, nunca un `UPDATE` (`0002` §3: la historia no se reescribe). Por eso
 * `reemplazado` tampoco está acá: aparece recién con F3, cuando AlToke es el emisor.
 */

/**
 * Modo fiscal del tenant, con los valores del `CHECK` de `tenants.modo_fiscal`
 * (`apps/api/migrations/0001_esquema_inicial.sql`), no las etiquetas F0–F3 que usa `0002` §2:
 * **F0 es `ninguno`**.
 *
 * Se declara acá, y no en el API, porque es el dominio el que decide si un modo necesita
 * comprobante; la base sólo guarda el texto. Si el `CHECK` cambia, este arreglo cambia con él.
 */
export const MODOS_FISCALES = ['ninguno', 'controlador_fiscal', 'factura_electronica'] as const
export type ModoFiscal = (typeof MODOS_FISCALES)[number]

/**
 * ¿Este tenant necesita un comprobante fiscal por cada venta?
 *
 * En F0 (`ninguno`) no: el ticket es interno y declara que no es comprobante válido, así que el
 * cobro no encola nada. Todos los demás modos sí, porque en todos hay un emisor —la impresora, el
 * facturador del contador o AlToke— y el comprobante es lo que hay que conseguir.
 */
export function requiereEmisionFiscal(modo: ModoFiscal): boolean {
  if (!(MODOS_FISCALES as readonly string[]).includes(modo)) {
    throw new RangeError(`Modo fiscal desconocido: ${String(modo)}`)
  }

  return modo !== 'ninguno'
}

export const ESTADOS_EMISION = ['pendiente', 'emitido', 'fallido'] as const
export type EstadoEmision = (typeof ESTADOS_EMISION)[number]

/**
 * Una emisión fiscal en el outbox: una fila de `outbox_fiscal` sin su `tenant_id` de más.
 *
 * Los nombres en camelCase son los de la tabla en snake_case (`proximo_intento_en`, `creado_en`):
 * el tipo del dominio es la forma que el borde traduce, no otra estructura paralela.
 */
export interface EmisionFiscal {
  /** ULID. Opaco para el dominio: sólo tiene que ser único y no vacío. */
  readonly id: string
  readonly tenantId: string
  readonly ventaId: string
  /** `pendiente → emitido | fallido`; un `fallido` vuelve a `pendiente` para reintentar. */
  readonly estado: EstadoEmision
  /** Intentos ya registrados. Cero significa que todavía nadie lo intentó. */
  readonly intentos: number
  /**
   * ISO-8601 de cuándo toca el próximo intento. `null` = no hay intento programado: en `emitido`
   * ya no hay nada que hacer, y en `fallido` la emisión espera acción humana (`0002` §4).
   */
  readonly proximoIntentoEn: string | null
  /** Por qué falló el último intento; `null` si nunca falló. */
  readonly motivo: string | null
  /** ISO-8601 del alta en el outbox. */
  readonly creadoEn: string
}

const TRANSICIONES: Readonly<Record<EstadoEmision, readonly EstadoEmision[]>> = {
  pendiente: ['emitido', 'fallido'],
  // `0002` §4: un fallido se reintenta. Volver a `pendiente` es lo que lo pone en la cola otra vez.
  fallido: ['pendiente'],
  // La corrección es un documento nuevo: no se reescribe lo emitido.
  emitido: [],
}

/** Los estados a los que puede ir una emisión desde `estado`. */
export function transicionesDe(estado: EstadoEmision): readonly EstadoEmision[] {
  const transiciones = TRANSICIONES[estado]

  if (transiciones === undefined) {
    throw new RangeError(`Estado de emisión desconocido: ${String(estado)}`)
  }

  return transiciones
}

/** Qué puede moverse a qué: una transición no listada es un error, no un `no-op`. */
export function puedeTransicionar(desde: EstadoEmision, hacia: EstadoEmision): boolean {
  return transicionesDe(desde).includes(hacia)
}

function exigirTransicion(emision: EmisionFiscal, hacia: EstadoEmision): void {
  if (puedeTransicionar(emision.estado, hacia)) return

  throw new RangeError(
    `Una emisión ${emision.estado} no puede pasar a ${hacia}: ${emision.id}` +
      (emision.estado === 'emitido' ? ' (lo emitido se corrige con una nota de crédito).' : '.'),
  )
}

function textoNoVacio(valor: unknown): valor is string {
  return typeof valor === 'string' && valor.trim() !== ''
}

function exigirTexto(valor: unknown, campo: string): void {
  if (!textoNoVacio(valor)) throw new TypeError(`${campo} debe ser un texto no vacío: ${String(valor)}`)
}

function exigirFecha(valor: unknown, campo: string): void {
  if (typeof valor !== 'string' || Number.isNaN(new Date(valor).getTime())) {
    throw new TypeError(`${campo} debe ser una fecha ISO-8601: ${String(valor)}`)
  }
}

export interface DatosDeEmision {
  readonly id: string
  readonly tenantId: string
  readonly ventaId: string
  readonly creadoEn: string
}

/**
 * El primer intento: la emisión recién encolada por una venta confirmada.
 *
 * Nace `pendiente` con `intentos: 0` —nadie lo intentó todavía— y con el primer intento **ya
 * vencido** (`proximoIntentoEn = creadoEn`). No se programa para más adelante a propósito: la
 * venta acaba de pasar y su comprobante es lo más urgente que hay en la cola. Así «vencido» es la
 * misma pregunta para la primera vez y para un reintento, y no hace falta un caso especial.
 */
export function emisionInicial(datos: DatosDeEmision): EmisionFiscal {
  exigirTexto(datos.id, 'id')
  exigirTexto(datos.tenantId, 'tenantId')
  exigirTexto(datos.ventaId, 'ventaId')
  exigirFecha(datos.creadoEn, 'creadoEn')

  return {
    id: datos.id,
    tenantId: datos.tenantId,
    ventaId: datos.ventaId,
    estado: 'pendiente',
    intentos: 0,
    proximoIntentoEn: datos.creadoEn,
    motivo: null,
    creadoEn: datos.creadoEn,
  }
}

/**
 * El comprobante salió: el emisor lo aceptó y el outbox queda en paz.
 *
 * Limpia `motivo` y `proximoIntentoEn`: el motivo era del último intento fallido y ya no hay nada
 * programado. El contador de intentos **no se reinicia**: es la historia de lo que costó emitirlo.
 */
export function marcarEmitida(emision: EmisionFiscal): EmisionFiscal {
  exigirTransicion(emision, 'emitido')

  return {
    ...emision,
    estado: 'emitido',
    intentos: emision.intentos + 1,
    proximoIntentoEn: null,
    motivo: null,
  }
}

export interface FalloDeEmision {
  /** Qué dijo el emisor. No se puede reintentar lo que no se sabe qué pasó. */
  readonly motivo: string
  /** Cuándo reintentar; ausente o `null` = espera acción humana (`0002` §4). */
  readonly proximoIntentoEn?: string | null
}

/** El intento falló: se cuenta, se guarda el motivo y la emisión queda como deuda documental. */
export function marcarFallida(emision: EmisionFiscal, fallo: FalloDeEmision): EmisionFiscal {
  exigirTransicion(emision, 'fallido')
  exigirTexto(fallo.motivo, 'motivo')

  const proximoIntentoEn = fallo.proximoIntentoEn ?? null
  if (proximoIntentoEn !== null) exigirFecha(proximoIntentoEn, 'proximoIntentoEn')

  return {
    ...emision,
    estado: 'fallido',
    intentos: emision.intentos + 1,
    proximoIntentoEn,
    motivo: fallo.motivo,
  }
}

/**
 * Un `fallido` vuelve a la cola: `pendiente` otra vez, con la hora del próximo intento.
 *
 * El `motivo` se conserva: si vuelve a fallar por lo mismo, el cajero tiene que poder leerlo sin
 * que nadie lo haya borrado en el camino. Los `intentos` tampoco se reinician.
 */
export function programarReintento(emision: EmisionFiscal, proximoIntentoEn: string): EmisionFiscal {
  exigirTransicion(emision, 'pendiente')
  exigirFecha(proximoIntentoEn, 'proximoIntentoEn')

  return { ...emision, estado: 'pendiente', proximoIntentoEn }
}

/**
 * ¿Toca intentarlo ahora?
 *
 * Sólo una emisión `pendiente` con hora programada puede estar vencida: `emitido` ya terminó y un
 * `fallido` espera que alguien lo reprograme. La comparación es de instantes y no de texto, así que
 * dos formatos distintos de la misma hora dan la misma respuesta.
 */
export function esReintentoVencido(emision: EmisionFiscal, ahora: string): boolean {
  exigirFecha(ahora, 'ahora')

  if (emision.estado !== 'pendiente' || emision.proximoIntentoEn === null) return false

  return new Date(emision.proximoIntentoEn).getTime() <= new Date(ahora).getTime()
}
