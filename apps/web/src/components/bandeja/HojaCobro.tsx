import { Banknote, Check, CreditCard } from 'lucide-react'
import { Button } from '../ui/button'
import { centavosDesdePesos, formatearCentavos, pesosDesdeCentavos } from '../../formato'
import type { LineaDeVenta, TotalesVenta } from '../../pos/venta'

/** Billetes que el cajero tiene a mano cuando cobra en efectivo, en pesos. */
const BILLETES = [1000, 2000, 5000, 10000, 20000, 50000] as const

/**
 * Montos rápidos: el total exacto y los dos billetes redondos que lo cubren.
 *
 * Se derivan del total y no de una lista fija: los tres botones de $50.000 no ayudan en una venta
 * de $24, y el cajero toca el que tiene en la mano. El total exacto va primero porque es el caso
 * más común del kiosco.
 */
function billetesRapidos(totalCentavos: number): readonly number[] {
  const montos: number[] = [totalCentavos]

  for (const pesos of BILLETES) {
    const centavos = pesos * 100

    if (centavos > totalCentavos) montos.push(centavos)
    if (montos.length === 3) return montos
  }

  return montos
}

/** Botón de medio de pago o de billete: el elegido se marca con `aria-pressed` y, además, se ve. */
function claseElegible(elegido: boolean, base: string): string {
  return `transition-colors duration-150 ease-out motion-reduce:transition-none ${base} ${
    elegido
      ? 'border-primary bg-accent text-accent-foreground'
      : 'border-border bg-muted text-foreground'
  }`
}

export interface HojaCobroProps {
  /** La hoja sube sobre la venta; cerrada sigue montada porque los controles no se desmontan. */
  readonly abierta: boolean
  readonly lineas: readonly LineaDeVenta[]
  readonly totales: TotalesVenta
  readonly efectivoPesos: string
  readonly esTarjeta: boolean
  readonly onCambiarEfectivo: (pesos: string) => void
  readonly onElegirTarjeta: (esTarjeta: boolean) => void
  readonly onConfirmar: () => void
  readonly onCerrar: () => void
}

/**
 * Hoja de cobro (T5): sube desde abajo sobre la pantalla de venta y junta el paso que faltaba
 * entre COBRAR y el ticket de 80 mm.
 *
 * No decide plata: `calcularTotales` ya dio el total y el IVA, y el que dice si el pago cubre la
 * venta es `pos/caja.ts` —acá sólo se refleja ese estado en la pantalla: si el efectivo no llega,
 * el vuelto se pinta en error, el motivo se escribe y el botón de confirmar se deshabilita. La
 * confirmación dispara el mismo `onCobrar` de siempre; el cobro sigue siendo cosa de la caja.
 *
 * Los dos medios que existen son efectivo y tarjeta manual (`esTarjeta`): "QR / transferencia" es
 * el mismo campo y por eso comparte botón.
 */
export function HojaCobro({
  abierta,
  lineas,
  totales,
  efectivoPesos,
  esTarjeta,
  onCambiarEfectivo,
  onElegirTarjeta,
  onConfirmar,
  onCerrar,
}: HojaCobroProps) {
  const unidades = lineas.reduce((suma, linea) => suma + linea.cantidad, 0)
  const recibidoCentavos = centavosDesdePesos(efectivoPesos)
  const vueltoCentavos =
    recibidoCentavos === null ? null : recibidoCentavos - totales.totalCentavos
  const faltaCentavos = vueltoCentavos === null ? null : Math.abs(vueltoCentavos)

  const alcanzaEfectivo = vueltoCentavos !== null && vueltoCentavos >= 0
  const alcanza = esTarjeta || alcanzaEfectivo
  const puedeConfirmar = lineas.length > 0 && alcanza
  const estadoHoja = abierta ? 'open' : 'closed'

  const clasesVuelto = esTarjeta
    ? 'border-border bg-muted text-foreground'
    : alcanzaEfectivo
      ? 'border-success bg-success-soft text-success-soft-foreground'
      : 'border-destructive bg-danger-soft text-danger-soft-foreground'

  return (
    <>
      <div
        aria-hidden="true"
        data-state={estadoHoja}
        className="fixed inset-0 z-30 bg-foreground/40 transition-opacity duration-200 ease-out data-[state=closed]:pointer-events-none data-[state=closed]:opacity-0 motion-reduce:transition-none"
      />

      <section
        role="dialog"
        aria-modal={abierta ? true : undefined}
        aria-labelledby="hoja-cobro-titulo"
        aria-hidden={abierta ? undefined : true}
        // `aria-hidden` saca la hoja del árbol de accesibilidad pero deja sus
        // controles enfocables con Tab: `inert` cierra esa brecha sin desmontar
        // (los tests consultan los labels con la hoja cerrada).
        inert={abierta ? undefined : true}
        data-state={estadoHoja}
        className="fixed inset-x-[var(--page-margin-desktop)] bottom-[var(--space-lg)] z-40 mx-auto grid max-h-[calc(100dvh-6rem)] w-auto max-w-[46rem] overflow-y-auto rounded-lg bg-card text-foreground shadow-[var(--shadow-overlay)] transition-[transform,opacity] duration-200 ease-out data-[state=closed]:invisible data-[state=closed]:translate-y-[calc(100%+3rem)] data-[state=closed]:opacity-0 motion-reduce:transition-none"
      >
        <div aria-hidden="true" className="grid h-6 place-items-center">
          <span className="block h-1 w-12 rounded-full bg-border" />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-[var(--space-lg)] px-[var(--space-lg)] pb-[var(--space-md)]">
          <div>
            <span
              id="hoja-cobro-titulo"
              className="block text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground"
            >
              Cobrar venta
            </span>
            <span className="block font-sans text-[2.5rem] font-bold leading-[3rem] tracking-[-0.03em] tabular-nums">
              {formatearCentavos(totales.totalCentavos)}
            </span>
          </div>

          <p className="text-right text-xs leading-[1.125rem] text-muted-foreground">
            <span className="block text-sm font-semibold text-foreground">
              {unidades === 1 ? '1 ítem' : `${unidades} ítems`}
            </span>
            IVA incluido
            <span className="block tabular-nums">{formatearCentavos(totales.ivaCentavos)}</span>
          </p>
        </div>

        <div className="grid gap-[var(--space-lg)] border-t border-border px-[var(--space-lg)] py-[var(--space-md)] md:grid-cols-2">
          <div>
            <h3 className="mb-[var(--space-sm)] text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
              Con qué paga
            </h3>

            <div role="group" aria-label="Medio de pago" className="grid gap-[var(--space-sm)]">
              <Button
                type="button"
                variant="ghost"
                aria-label="Efectivo"
                aria-pressed={!esTarjeta}
                onClick={() => onElegirTarjeta(false)}
                className={claseElegible(
                  !esTarjeta,
                  'min-h-[3.5rem] w-full justify-between rounded-md border px-[var(--space-md)] text-[0.9375rem] font-semibold',
                )}
              >
                <span className="text-left">
                  Efectivo
                  <small className="block text-[0.6875rem] font-semibold uppercase leading-3.5 tracking-[0.04em] opacity-75">
                    vuelto en mano
                  </small>
                </span>
                <Banknote aria-hidden="true" className="size-5" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                aria-label="Tarjeta (manual)"
                aria-pressed={esTarjeta}
                onClick={() => onElegirTarjeta(true)}
                className={claseElegible(
                  esTarjeta,
                  'min-h-[3.5rem] w-full justify-between rounded-md border px-[var(--space-md)] text-[0.9375rem] font-semibold',
                )}
              >
                <span className="text-left">
                  QR / transferencia
                  <small className="block text-[0.6875rem] font-semibold uppercase leading-3.5 tracking-[0.04em] opacity-75">
                    con tarjeta · sin vuelto
                  </small>
                </span>
                <CreditCard aria-hidden="true" className="size-5" />
              </Button>
            </div>

            <h3 className="mb-[var(--space-sm)] mt-[var(--space-md)] text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
              Billetes rápidos
            </h3>

            <div
              role="group"
              aria-label="Con cuánto paga"
              className="grid grid-cols-3 gap-[var(--space-sm)]"
            >
              {billetesRapidos(totales.totalCentavos).map((centavos) => {
                const elegido = recibidoCentavos === centavos

                return (
                  <Button
                    key={centavos}
                    type="button"
                    variant="ghost"
                    aria-pressed={elegido}
                    disabled={esTarjeta}
                    onClick={() => onCambiarEfectivo(pesosDesdeCentavos(centavos))}
                    className={claseElegible(
                      elegido,
                      'min-h-[var(--size-control)] rounded-md border px-[var(--space-sm)] text-sm font-bold tabular-nums',
                    )}
                  >
                    {formatearCentavos(centavos)}
                  </Button>
                )
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-[var(--space-sm)] text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
              Vuelto
            </h3>

            <div className="grid gap-[var(--space-sm)]">
              <label className="grid gap-[var(--space-xs)]">
                <span className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.04em] text-muted-foreground">
                  Efectivo recibido
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="Efectivo recibido en pesos"
                  value={efectivoPesos}
                  disabled={esTarjeta}
                  onChange={(evento) => onCambiarEfectivo(evento.target.value)}
                  className="min-h-[var(--size-control)] w-full rounded-md border border-dashed border-input bg-muted px-[var(--space-md)] text-right font-sans text-2xl font-bold tabular-nums disabled:opacity-50"
                />
              </label>

              <div
                className={`flex items-baseline justify-between gap-[var(--space-md)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] ${clasesVuelto}`}
              >
                <span className="text-[0.6875rem] font-bold uppercase leading-4 tracking-[0.04em]">
                  {esTarjeta
                    ? 'Vuelto · con tarjeta no se da'
                    : alcanzaEfectivo
                      ? 'Vuelto'
                      : 'Vuelto · falta efectivo'}
                </span>
                <b className="font-sans text-[2rem] font-bold leading-[2.5rem] tabular-nums">
                  {formatearCentavos(esTarjeta ? 0 : (vueltoCentavos ?? 0))}
                </b>
              </div>

              {!esTarjeta && !alcanzaEfectivo && (
                <p role="alert" className="text-xs leading-4 text-destructive">
                  {faltaCentavos === null
                    ? 'El efectivo recibido no es un monto: escribí cuánto paga el cliente.'
                    : `Faltan cobrar ${formatearCentavos(faltaCentavos)} para cubrir el total. No se puede cobrar con menos.`}
                </p>
              )}
            </div>

            <p className="mt-[var(--space-md)] text-xs leading-[1.125rem] text-muted-foreground">
              Al confirmar, la venta se guarda en el libro local y sale el ticket de 80 mm.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-[var(--space-md)] px-[var(--space-lg)] pb-[var(--space-lg)] pt-[var(--space-md)]">
          <Button
            type="button"
            variant="outline"
            onClick={onCerrar}
            className="min-h-[4rem] rounded-lg px-[var(--space-lg)] text-[0.8125rem] font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none"
          >
            Volver
          </Button>

          <Button
            type="button"
            disabled={!puedeConfirmar}
            onClick={onConfirmar}
            className="flex min-h-[4rem] flex-1 items-center justify-center gap-[var(--space-sm)] rounded-lg bg-primary px-[var(--space-lg)] text-sm font-bold tracking-[0.04em] text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.985] disabled:bg-sunken-deep disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <Check aria-hidden="true" className="size-[1.125rem]" />
            Cobrar y sacar ticket
          </Button>
        </div>
      </section>
    </>
  )
}
