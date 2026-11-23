import { useMemo, useState } from 'react'
import type { StockPorSku } from '@altoke/domain'
import { Search } from 'lucide-react'
import type { ProductoDeCatalogo } from '../../catalogo'
import type { LineaDeVenta, TotalesVenta } from '../../pos/venta'
import { GrillaProductos } from '../GrillaProductos'
import { PanelVenta } from '../PanelVenta'
import { CATEGORIA_TODAS, RielCategorias } from './RielCategorias'
import type { CategoriaDeVenta } from './RielCategorias'

export interface PantallaVentaProps {
  readonly productos: readonly ProductoDeCatalogo[]
  readonly stock: StockPorSku
  readonly onAgregar: (producto: ProductoDeCatalogo) => void
  readonly lineas: readonly LineaDeVenta[]
  readonly totales: TotalesVenta
  readonly efectivoPesos: string
  readonly esTarjeta: boolean
  readonly onCambiarCantidad: (sku: string, delta: number) => void
  readonly onQuitar: (sku: string) => void
  readonly onVaciar: () => void
  readonly onCambiarEfectivo: (pesos: string) => void
  readonly onCambiarTarjeta: (esTarjeta: boolean) => void
  readonly onCobrar: () => void
}

/**
 * Pantalla de venta del kiosco: riel de categorías, grilla de productos y bandeja de venta.
 *
 * Es la composición de la pantalla y nada más: los productos y el stock llegan del catálogo y del
 * libro, y los importes ya vienen calculados en `totales`. Lo único que administra acá es el
 * filtro de la grilla (categoría y búsqueda), que es estado de pantalla y no de la venta.
 */
export function PantallaVenta({
  productos,
  stock,
  onAgregar,
  lineas,
  totales,
  efectivoPesos,
  esTarjeta,
  onCambiarCantidad,
  onQuitar,
  onVaciar,
  onCambiarEfectivo,
  onCambiarTarjeta,
  onCobrar,
}: PantallaVentaProps) {
  const [consulta, setConsulta] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState(CATEGORIA_TODAS)

  const categorias = useMemo(() => agruparCategorias(productos), [productos])

  const visibles = useMemo(() => {
    const buscado = consulta.trim().toLowerCase()

    return productos.filter((producto) => {
      const enCategoria =
        categoriaActiva === CATEGORIA_TODAS || categoriaDe(producto) === categoriaActiva
      const enBusqueda = buscado === '' || producto.nombre.toLowerCase().includes(buscado)

      return enCategoria && enBusqueda
    })
  }, [productos, categoriaActiva, consulta])

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[6.5rem_minmax(0,1fr)] bg-muted">
      <RielCategorias
        categorias={categorias}
        activa={categoriaActiva}
        onElegir={setCategoriaActiva}
      />

      <div className="grid min-h-0 [grid-template-rows:auto_minmax(0,1fr)_auto] px-[var(--page-margin-desktop)] pt-[var(--space-lg)]">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-[var(--space-md)] top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            aria-label="Buscar o escanear producto"
            placeholder="Buscar o escanear código de barras…"
            autoComplete="off"
            value={consulta}
            onChange={(evento) => setConsulta(evento.target.value)}
            className="min-h-[3.5rem] w-full rounded-lg border border-input bg-card pl-13 pr-[var(--space-md)] text-base placeholder:text-placeholder-ink"
          />
        </div>

        <GrillaProductos productos={visibles} stock={stock} onAgregar={onAgregar} />

        <PanelVenta
          lineas={lineas}
          totales={totales}
          efectivoPesos={efectivoPesos}
          esTarjeta={esTarjeta}
          onCambiarCantidad={onCambiarCantidad}
          onQuitar={onQuitar}
          onVaciar={onVaciar}
          onCambiarEfectivo={onCambiarEfectivo}
          onCambiarTarjeta={onCambiarTarjeta}
          onCobrar={onCobrar}
        />
      </div>
    </div>
  )
}

/**
 * Categorías que existen en el catálogo, en el orden en que aparecen los productos.
 *
 * Hoy `catalogo.ts` todavía no declara categorías, así que el riel muestra el único grupo real
 * que hay —todo el catálogo— en vez de seis botones inventados. Cuando el catálogo sume el campo,
 * el riel lo levanta sin tocar este archivo.
 */
function agruparCategorias(productos: readonly ProductoDeCatalogo[]): readonly CategoriaDeVenta[] {
  const vistas: CategoriaDeVenta[] = []

  for (const producto of productos) {
    const id = categoriaDe(producto)

    if (!vistas.some((categoria) => categoria.id === id)) vistas.push({ id, etiqueta: id })
  }

  return vistas.length === 0 ? [{ id: CATEGORIA_TODAS, etiqueta: CATEGORIA_TODAS }] : vistas
}

/** Categoría declarada por el producto; sin ella, el producto cae en "Todo". */
function categoriaDe(producto: ProductoDeCatalogo): string {
  if ('categoria' in producto) {
    const { categoria } = producto as { readonly categoria?: unknown }

    if (typeof categoria === 'string' && categoria.trim() !== '') return categoria.trim()
  }

  return CATEGORIA_TODAS
}
