import { Minus, Plus, X } from 'lucide-react'
import { importeLineaCentavos } from '../pos/venta'
import type { LineaDeVenta, TotalesVenta } from '../pos/venta'
import { formatearCentavos } from '../formato'

export interface PanelVentaProps {
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
 * Bandeja de venta, anclada abajo de la pantalla.
 *
 * Es la venta en curso y el cobro, al alcance del pulgar: mango, líneas con su stepper, total
 * grande y COBRAR con el importe adentro. Ningún total se calcula acá: `calcularTotales` ya lo
 * hizo y este panel sólo lo formatea. La cantidad se cambia de a una unidad porque es lo que hace
 * el cajero con el dedo.
 */
export function PanelVenta({
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
}: PanelVentaProps) {
  const unidades = lineas.reduce((suma, linea) => suma + linea.cantidad, 0)

  return (
    <section
      aria-label="Venta en curso"
      className="-mx-[var(--page-margin-desktop)] grid max-h-[min(26rem,58vh)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-t-lg border-t border-border bg-card shadow-[0_-8px_24px_-12px_rgb(0_0_0_/_18%)] animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
    >
      <div aria-hidden="true" className="grid h-6 place-items-center">
        <span className="block h-1 w-12 rounded-full bg-border" />
      </div>

      <div className="grid min-h-0 [grid-template-rows:auto_minmax(0,1fr)]">
        <div className="flex items-baseline gap-[var(--space-md)] px-[var(--page-margin-desktop)] pb-[var(--space-sm)]">
          <h2 className="font-sans text-xl font-semibold tracking-[-0.01em]">Venta</h2>
          <span className="rounded-full bg-accent px-[var(--space-sm)] py-0.5 text-xs font-semibold tracking-[0.02em] text-accent-foreground tabular-nums">
            {unidades === 1 ? '1 ítem' : `${unidades} ítems`}
          </span>
          {lineas.length > 0 && (
            <button
              type="button"
              onClick={onVaciar}
              className="ml-auto p-[var(--space-xs)] text-xs font-semibold text-destructive"
            >
              Vaciar
            </button>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-[var(--page-margin-desktop)] [mask-image:linear-gradient(to_bottom,#000_calc(100%-2.5rem),transparent)]">
          {lineas.length === 0 ? (
            <p className="py-[var(--space-lg)] text-center text-sm text-muted-foreground">
              La venta está vacía. Tocá un producto para agregarlo.
            </p>
          ) : (
            <ul>
              {lineas.map((linea) => (
                <li
                  key={linea.sku}
                  className="grid animate-in grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-[var(--space-md)] border-t border-border py-[var(--space-sm)] fade-in slide-in-from-bottom-1 duration-150 motion-reduce:animate-none"
                >
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={`Quitar una unidad de ${linea.nombre}`}
                      onClick={() => onCambiarCantidad(linea.sku, -1)}
                      className="grid size-11 place-items-center rounded-md border border-border bg-muted active:bg-accent"
                    >
                      <Minus aria-hidden="true" className="size-4" />
                    </button>
                    <span className="min-w-6 text-center text-[0.9375rem] font-bold tabular-nums">
                      {linea.cantidad}
                    </span>
                    <button
                      type="button"
                      aria-label={`Agregar una unidad de ${linea.nombre}`}
                      onClick={() => onCambiarCantidad(linea.sku, 1)}
                      className="grid size-11 place-items-center rounded-md border border-border bg-muted active:bg-accent"
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </button>
                  </span>

                  <span className="text-[0.9375rem] leading-5">
                    {linea.nombre}
                    <small className="block text-xs text-muted-foreground tabular-nums">
                      {formatearCentavos(linea.precioUnitarioCentavos)} c/u
                    </small>
                  </span>

                  <span className="min-w-24 text-right text-base font-semibold tabular-nums">
                    {formatearCentavos(importeLineaCentavos(linea))}
                  </span>

                  <button
                    type="button"
                    aria-label={`Quitar ${linea.nombre} de la venta`}
                    onClick={() => onQuitar(linea.sku)}
                    className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-danger-soft hover:text-danger-soft-foreground"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-[var(--space-lg)] bg-card px-[var(--page-margin-desktop)] py-[var(--space-md)]">
        <div>
          <small className="block text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.04em] text-muted-foreground">
            Total
          </small>
          <span
            data-testid="total-venta"
            className="block font-sans text-[2rem] font-bold leading-10 tracking-[-0.02em] tabular-nums"
          >
            {formatearCentavos(totales.totalCentavos)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            IVA incluido · {formatearCentavos(totales.ivaCentavos)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-[var(--space-sm)]">
          <label className="flex flex-col">
            <span className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.04em] text-muted-foreground">
              Efectivo recibido ($)
            </span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Efectivo recibido en pesos"
              value={efectivoPesos}
              disabled={esTarjeta}
              onChange={(evento) => onCambiarEfectivo(evento.target.value)}
              className="min-h-[var(--size-touch-min)] w-40 rounded-md border border-input bg-card px-[var(--space-sm)] text-base tabular-nums disabled:opacity-50"
            />
          </label>

          <label className="flex min-h-[var(--size-touch-min)] items-center gap-[var(--space-sm)] rounded-md border border-border px-[var(--space-sm)]">
            <input
              type="checkbox"
              aria-label="Tarjeta (manual)"
              checked={esTarjeta}
              onChange={(evento) => onCambiarTarjeta(evento.target.checked)}
              className="size-5"
            />
            <span className="text-sm font-semibold">Tarjeta (manual)</span>
          </label>
        </div>

        <button
          type="button"
          aria-label="Cobrar"
          disabled={lineas.length === 0}
          onClick={onCobrar}
          className="ml-auto flex min-h-[4rem] min-w-[min(22rem,100%)] items-center justify-between gap-[var(--space-lg)] rounded-lg bg-primary px-[var(--space-lg)] text-sm font-bold uppercase tracking-[0.04em] text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.985] disabled:bg-sunken-deep disabled:text-muted-foreground motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <span>Cobrar</span>
          <span className="text-xl tracking-[-0.01em] tabular-nums">
            {formatearCentavos(totales.totalCentavos)}
          </span>
        </button>
      </div>
    </section>
  )
}
