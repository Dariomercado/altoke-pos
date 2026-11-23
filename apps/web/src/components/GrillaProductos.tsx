import type { StockPorSku } from '@altoke/domain'
import type { ProductoDeCatalogo } from '../catalogo'
import { formatearCentavos } from '../formato'

export interface GrillaProductosProps {
  readonly productos: readonly ProductoDeCatalogo[]
  readonly stock: StockPorSku
  readonly onAgregar: (producto: ProductoDeCatalogo) => void
}

/**
 * Grilla de productos del kiosco.
 *
 * El stock que se muestra es la proyección del libro, no un contador local: si otra terminal
 * vendió el último alfajor, esta tecla se apaga sin que nadie la toque.
 */
export function GrillaProductos({ productos, stock, onAgregar }: GrillaProductosProps) {
  return (
    <section className="grilla" aria-label="Productos">
      {productos.map((producto) => {
        const disponible = stock[producto.sku] ?? 0
        const sinStock = disponible <= 0

        return (
          <button
            key={producto.sku}
            type="button"
            className={sinStock ? 'producto producto--sin-stock' : 'producto'}
            disabled={sinStock}
            onClick={() => onAgregar(producto)}
          >
            <span className="producto__nombre">{producto.nombre}</span>
            <span className="producto__precio">
              {formatearCentavos(producto.precioUnitarioCentavos)}
            </span>
            <span className="producto__stock">Stock: {disponible}</span>
            {sinStock && <span className="producto__motivo">Sin stock: no se puede vender</span>}
          </button>
        )
      })}
    </section>
  )
}
