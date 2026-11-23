import { Minus, Plus } from 'lucide-react'
import type { Centavos } from '@altoke/domain'
import { formatearCentavos } from '../../formato'

/** Qué es la fila. El arqueo cuenta valor, no material: el tipo sólo cambia la etiqueta. */
export type TipoDeDenominacion = 'billete' | 'moneda'

export interface FilaDenominacionProps {
  readonly denominacion: Centavos
  readonly tipo: TipoDeDenominacion
  readonly cantidad: number
  readonly onCambiarCantidad: (cantidad: number) => void
}

const BOTON_DEL_PASO =
  'grid size-[var(--size-touch-min)] place-items-center rounded-md border border-border bg-muted text-foreground transition-colors duration-150 ease-out hover:bg-sunken active:scale-95 disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100'

/**
 * Una denominación del cajón: monto, cantidad y subtotal en una fila que se toca entera.
 *
 * Los `−` / `+` son el camino del cajero de pie (una mano, guante, luz de vidriera) y el
 * `spinbutton` del medio sigue existiendo para escribir la cantidad de una pila ya contada: el
 * nombre accesible `Cantidad de <n> centavos` es el contrato con la pantalla y con los tests.
 * Las flechitas nativas del `input type="number"` se apagan porque miden 12 px y acá nada toca
 * menos de 44.
 */
export function FilaDenominacion({
  denominacion,
  tipo,
  cantidad,
  onCambiarCantidad,
}: FilaDenominacionProps) {
  const monto = formatearCentavos(denominacion)
  const vacia = cantidad === 0
  const subtotalCentavos = denominacion * cantidad
  const articulo = tipo === 'moneda' ? 'una' : 'un'

  return (
    <div
      className={`grid grid-cols-[7.5rem_auto_minmax(0,1fr)_8rem] items-center gap-[var(--space-md)] rounded-md border border-border bg-card py-[var(--space-xs)] pl-[var(--space-md)] pr-[var(--space-md)] ${
        vacia ? 'border-dashed' : ''
      }`}
    >
      <span className="font-sans text-base font-bold leading-6 tracking-[-0.01em] tabular-nums">
        {monto}
        <small className="block text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          {tipo}
        </small>
      </span>

      <div className="flex items-center gap-[var(--space-sm)]">
        <button
          type="button"
          disabled={vacia}
          aria-label={`Quitar ${articulo} ${tipo} de ${monto}`}
          onClick={() => onCambiarCantidad(Math.max(0, cantidad - 1))}
          className={BOTON_DEL_PASO}
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>

        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-label={`Cantidad de ${denominacion} centavos`}
          value={cantidad}
          onChange={(evento) => onCambiarCantidad(cantidadDesdeTexto(evento.target.value))}
          className={`min-h-[var(--size-touch-min)] w-16 rounded-md border border-input bg-card text-center font-sans text-[1.375rem] font-bold leading-7 tracking-[-0.015em] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
            vacia ? 'text-muted-foreground' : 'text-foreground'
          }`}
        />

        <button
          type="button"
          aria-label={`Agregar ${articulo} ${tipo} de ${monto}`}
          onClick={() => onCambiarCantidad(cantidad + 1)}
          className={BOTON_DEL_PASO}
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      </div>

      <span aria-hidden="true" />

      <span
        className={`text-right text-[0.9375rem] font-semibold tabular-nums ${
          vacia ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        {formatearCentavos(subtotalCentavos)}
      </span>
    </div>
  )
}

/** Un conteo vacío o inválido es cero unidades: nunca se inventa plata en el cajón. */
function cantidadDesdeTexto(texto: string): number {
  const cantidad = Number(texto)

  return Number.isInteger(cantidad) && cantidad >= 0 ? cantidad : 0
}
