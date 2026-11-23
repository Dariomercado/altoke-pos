/**
 * Catálogo del kiosco demo (S4: kioscos y tiendas de barrio chico/mediano).
 *
 * Ocho productos de góndola reales con precio de venta al público: **el precio ya incluye IVA**
 * (invariante I3), así que es exactamente el número que el cliente paga y el que se imprime.
 * Ningún precio se calcula acá: el catálogo es un dato, no una fórmula.
 *
 * El stock inicial se siembra una sola vez por terminal (`Caja.sembrar`), la primera vez que se
 * abre el POS sobre un libro vacío. Después el stock es la proyección del libro, no este número.
 */

import type { AlicuotaBps, Centavos } from '@altoke/domain'
import { ALICUOTA_KIOSCO } from './pos/venta'

export interface ProductoDeCatalogo {
  readonly sku: string
  readonly nombre: string
  /** Precio de góndola con IVA incluido. */
  readonly precioUnitarioCentavos: Centavos
  readonly alicuotaBps: AlicuotaBps
  /** Unidades que se cargan en el libro la primera vez que arranca el POS. */
  readonly stockInicial: number
}

export const CATALOGO: readonly ProductoDeCatalogo[] = [
  {
    sku: 'alfajor',
    nombre: 'Alfajor triple',
    precioUnitarioCentavos: 1210,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'gaseosa',
    nombre: 'Gaseosa cola 500 ml',
    precioUnitarioCentavos: 2500,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'agua',
    nombre: 'Agua mineral 500 ml',
    precioUnitarioCentavos: 1800,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'cigarrillos',
    nombre: 'Cigarrillos 20 unidades',
    precioUnitarioCentavos: 4200,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'pan',
    nombre: 'Pan de mesa 500 g',
    precioUnitarioCentavos: 2300,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'leche',
    nombre: 'Leche entera 1 L',
    precioUnitarioCentavos: 1650,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'yerba',
    nombre: 'Yerba mate 1 kg',
    precioUnitarioCentavos: 3900,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
  {
    sku: 'chocolate',
    nombre: 'Chocolate 100 g',
    precioUnitarioCentavos: 2100,
    alicuotaBps: ALICUOTA_KIOSCO,
    stockInicial: 24,
  },
]

/** Stock inicial por SKU que se siembra en el libro. */
export const STOCK_INICIAL: Readonly<Record<string, number>> = Object.fromEntries(
  CATALOGO.map((producto) => [producto.sku, producto.stockInicial]),
)
