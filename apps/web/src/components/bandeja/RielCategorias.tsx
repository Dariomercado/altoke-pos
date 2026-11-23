import type { LucideIcon } from 'lucide-react'
import { LayoutGrid, Tag } from 'lucide-react'

/** El grupo que no filtra nada: todo el catálogo. */
export const CATEGORIA_TODAS = 'Todo'

export interface CategoriaDeVenta {
  readonly id: string
  readonly etiqueta: string
}

export interface RielCategoriasProps {
  readonly categorias: readonly CategoriaDeVenta[]
  readonly activa: string
  readonly onElegir: (id: string) => void
}

const ICONO_POR_DEFECTO: LucideIcon = Tag

/**
 * Riel de categorías, a la izquierda de la grilla.
 *
 * La categoría activa se marca con **fondo y borde** a la vez (`aria-current` + las dos señales
 * visuales): en una pantalla táctil el color solo no alcanza para distinguir el estado.
 */
export function RielCategorias({ categorias, activa, onElegir }: RielCategoriasProps) {
  return (
    <nav
      aria-label="Categorías"
      className="flex min-h-0 flex-col gap-[var(--space-sm)] overflow-y-auto border-r border-border bg-card px-[var(--space-sm)] py-[var(--space-md)]"
    >
      {categorias.map((categoria) => {
        const esActiva = categoria.id === activa
        const Icono = iconoDeCategoria(categoria)

        return (
          <button
            key={categoria.id}
            type="button"
            aria-current={esActiva ? 'true' : undefined}
            onClick={() => onElegir(categoria.id)}
            className={`grid min-h-[4.25rem] place-items-center gap-0.5 rounded-md border px-1 py-1 text-[0.5625rem] font-bold uppercase leading-3 tracking-[0.03em] transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 ${
              esActiva
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-transparent text-muted-foreground'
            }`}
          >
            <Icono aria-hidden="true" className="size-6" />
            {categoria.etiqueta}
          </button>
        )
      })}
    </nav>
  )
}

function iconoDeCategoria(categoria: CategoriaDeVenta): LucideIcon {
  return categoria.id === CATEGORIA_TODAS ? LayoutGrid : ICONO_POR_DEFECTO
}
