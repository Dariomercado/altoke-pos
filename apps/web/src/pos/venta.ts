/**
 * Cuentas de una venta del POS, sin IO y sin React.
 *
 * Todo lo que se puede equivocar en plata vive acá y tiene test; los componentes sólo muestran
 * estos números. El precio de góndola **ya incluye IVA** (invariante I3), así que el IVA se
 * desglosa por grupo de alícuota invirtiendo el impuesto, no sumándolo sobre el neto.
 */

import { ALICUOTAS_IVA, desglosarIva, esCentavos } from '@altoke/domain'
import type { AlicuotaBps, Centavos } from '@altoke/domain'

export interface LineaDeVenta {
  readonly sku: string
  readonly nombre: string
  readonly cantidad: number
  readonly precioUnitarioCentavos: Centavos
  readonly alicuotaBps: AlicuotaBps
}

export interface TotalesVenta {
  /** Suma de los importes de línea, con IVA. */
  readonly totalCentavos: Centavos
  /** IVA contenido en ese total. */
  readonly ivaCentavos: Centavos
  /** Total menos IVA. */
  readonly netoCentavos: Centavos
}

/** Importe de una línea: precio unitario por cantidad, en centavos enteros. */
export function importeLineaCentavos(linea: LineaDeVenta): Centavos {
  if (!Number.isInteger(linea.cantidad) || linea.cantidad <= 0) {
    throw new RangeError(`Cantidad inválida para ${linea.sku}: ${linea.cantidad}`)
  }
  if (!esCentavos(linea.precioUnitarioCentavos)) {
    throw new RangeError(`Precio inválido para ${linea.sku}: ${linea.precioUnitarioCentavos}`)
  }

  return linea.precioUnitarioCentavos * linea.cantidad
}

/**
 * Totales de la venta.
 *
 * El IVA se calcula por grupo de alícuota y no línea por línea: redondear 30 líneas al centavo y
 * sumar da un IVA distinto —y peor— que redondear una vez por grupo. En un kiosco casi todo es
 * 21%, pero el modelo no asume eso: una alícuota distinta no puede romper el total.
 */
export function calcularTotales(lineas: readonly LineaDeVenta[]): TotalesVenta {
  if (lineas.length === 0) {
    return { totalCentavos: 0, ivaCentavos: 0, netoCentavos: 0 }
  }

  const importePorAlicuota = new Map<AlicuotaBps, Centavos>()

  for (const linea of lineas) {
    const importe = importeLineaCentavos(linea)
    const acumulado = importePorAlicuota.get(linea.alicuotaBps) ?? 0
    importePorAlicuota.set(linea.alicuotaBps, acumulado + importe)
  }

  let totalCentavos = 0
  let ivaCentavos = 0

  for (const [alicuotaBps, importe] of importePorAlicuota) {
    totalCentavos += importe
    ivaCentavos += desglosarIva(importe, alicuotaBps).ivaCentavos
  }

  return { totalCentavos, ivaCentavos, netoCentavos: totalCentavos - ivaCentavos }
}

/** Alícuota que usa el catálogo del kiosco cuando el producto no dice otra cosa. */
export const ALICUOTA_KIOSCO: AlicuotaBps = ALICUOTAS_IVA.general
