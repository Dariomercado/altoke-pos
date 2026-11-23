import type { StockPorSku } from '@altoke/domain'
import type { ProductoDeCatalogo } from '../catalogo'
import { formatearCentavos } from '../formato'

export interface GrillaProductosProps {
  readonly productos: readonly ProductoDeCatalogo[]
  readonly stock: StockPorSku
  readonly onAgregar: (producto: ProductoDeCatalogo) => void
}

/** Debajo de esto el tile avisa "Stock bajo" además de pintarse en rojo. */
const STOCK_BAJO = 3

/**
 * Grilla de productos del kiosco: tiles grandes, uno por producto.
 *
 * El stock que se muestra es la proyección del libro, no un contador local: si otra terminal
 * vendió el último alfajor, esta tecla se apaga sin que nadie la toque.
 *
 * Cada tile es un `<button>` cuyo texto empieza por el nombre del producto: así el nombre
 * accesible —y el dictado por voz— es el nombre del producto y no un "agregar" genérico. El "+"
 * es decoración (`aria-hidden`), porque la acción ya la dice el botón entero.
 */
export function GrillaProductos({ productos, stock, onAgregar }: GrillaProductosProps) {
  return (
    <section
      aria-label="Productos"
      className="grid min-h-0 content-start gap-[var(--space-md)] overflow-y-auto py-[var(--space-lg)] [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
    >
      {productos.length === 0 && (
        <p className="col-span-full py-[var(--space-lg)] text-center text-sm text-muted-foreground">
          No hay productos que coincidan con la búsqueda.
        </p>
      )}

      {productos.map((producto) => {
        const disponible = stock[producto.sku] ?? 0
        const sinStock = disponible <= 0
        const stockBajo = !sinStock && disponible <= STOCK_BAJO

        return (
          <button
            key={producto.sku}
            type="button"
            disabled={sinStock}
            onClick={() => onAgregar(producto)}
            className={`relative grid min-h-[7rem] content-between gap-[var(--space-xs)] rounded-lg border bg-card p-[var(--space-md)] text-left shadow-card transition-[transform,border-color,background-color] duration-150 ease-out focus-visible:border-primary active:scale-[0.97] active:border-primary disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100 ${
              stockBajo ? 'border-destructive/40' : 'border-border'
            }`}
          >
            <span
              aria-hidden="true"
              className="absolute right-[var(--space-md)] top-[var(--space-md)] grid size-7 place-items-center rounded-full bg-accent text-base font-bold leading-none text-accent-foreground"
            >
              +
            </span>

            <span className="min-h-[2.5rem] pr-8 text-[0.9375rem] font-semibold leading-5">
              {producto.nombre}
            </span>

            <span
              className={`font-sans text-2xl font-bold tracking-[-0.015em] tabular-nums ${
                stockBajo || sinStock ? 'text-destructive' : ''
              }`}
            >
              {formatearCentavos(producto.precioUnitarioCentavos)}
            </span>

            <span className="flex flex-wrap items-center gap-[var(--space-sm)] text-xs text-muted-foreground tabular-nums">
              Stock: {disponible}
              {stockBajo && (
                <span className="text-[0.625rem] font-bold uppercase tracking-[0.03em] text-destructive">
                  Stock bajo
                </span>
              )}
              {sinStock && (
                <span className="text-[0.625rem] font-bold uppercase tracking-[0.03em] text-destructive">
                  Sin stock: no se puede vender
                </span>
              )}
            </span>
          </button>
        )
      })}
    </section>
  )
}
