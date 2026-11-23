import { Check, Plus, Printer } from 'lucide-react'
import { Button } from '../ui/button'
import { formatearCentavos } from '../../formato'
import type { VentaCobrada } from '../../pos/caja'
import { ETIQUETA_MEDIO, Ticket } from '../Ticket'

export interface PantallaTicketProps {
  readonly venta: VentaCobrada
  readonly nombreTenant: string
  readonly terminalId: string
  /** El logo del tenant: sale en el ticket igual que en el ticket impreso. */
  readonly logoUrl?: string | undefined
  readonly onNuevaVenta: () => void
}

/**
 * Pantalla del ticket (T6): lo que el cajero ve después de cobrar.
 *
 * La venta ya está escrita en el libro (`pos/caja.ts`), así que acá no se decide nada: se confirma
 * lo que pasó y se muestran las dos cifras que el cajero necesita —total y **vuelto**— con el ticket
 * de 80 mm al lado, listo para arrancar del rollo.
 *
 * El ticket que se ve es el mismo `Ticket` que se imprime: no hay una copia "de pantalla". Por eso
 * imprimir desde acá no puede imprimir otra cosa que el papel real, y las reglas de `ticket.css`
 * (80 mm de papel, 72 mm útiles, la leyenda de ticket interno) siguen mandando sin cambios.
 *
 * "Nueva venta" es la acción principal: el kiosco cobra y sigue. La pantalla no se cierra sola para
 * que el vuelto quede en pantalla hasta que el cajero lo entregue.
 */
export function PantallaTicket({
  venta,
  nombreTenant,
  terminalId,
  logoUrl,
  onNuevaVenta,
}: PantallaTicketProps) {
  const recibidoCentavos = venta.pagos.reduce((suma, pago) => suma + pago.montoCentavos, 0)
  // Una venta puede cobrarse con dos medios; se nombran los dos y no se repite el mismo.
  const medios = [...new Set(venta.pagos.map((pago) => ETIQUETA_MEDIO[pago.medio]))].join(' + ')
  const hayVuelto = venta.cambioCentavos > 0
  // El vuelto sólo existe si entró efectivo: con tarjeta no se da, y decirlo evita que el cajero
  // busque monedas para una cifra que no es cero por casualidad.
  const soloTarjeta = venta.pagos.every((pago) => pago.medio !== 'efectivo')

  return (
    <section
      aria-label="Venta cobrada"
      className="pantalla-ticket fixed inset-x-0 bottom-0 top-[var(--size-header)] z-40 grid overflow-y-auto bg-background md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="flex flex-col gap-[var(--space-lg)] px-[var(--page-margin-desktop)] py-[var(--space-xl)]">
        <span
          aria-hidden="true"
          className="grid size-14 shrink-0 place-items-center rounded-full bg-success-soft text-success-soft-foreground"
        >
          <Check className="size-7" strokeWidth={2.5} />
        </span>

        <div>
          <h1 className="font-sans text-[2.5rem] font-bold leading-[3rem] tracking-[-0.03em]">
            Venta cobrada
          </h1>
          <p className="mt-[var(--space-sm)] max-w-[34ch] text-[0.9375rem] leading-6 text-muted-foreground">
            Quedó guardada en el libro local de esta terminal y el ticket salió por la impresora.
          </p>
        </div>

        <div
          className={`inline-grid gap-[var(--space-xs)] justify-self-start rounded-lg border px-[var(--space-lg)] py-[var(--space-md)] ${
            hayVuelto
              ? 'border-success bg-success-soft text-success-soft-foreground'
              : 'border-border bg-muted text-foreground'
          }`}
        >
          <span className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em]">
            {soloTarjeta ? 'Vuelto · con tarjeta no se da' : 'Vuelto'}
          </span>
          <b className="font-sans text-[3rem] font-bold leading-[3.5rem] tracking-[-0.03em] tabular-nums">
            {formatearCentavos(hayVuelto ? venta.cambioCentavos : 0)}
          </b>
        </div>

        <dl className="flex flex-wrap gap-[var(--space-xl)]">
          <Fila etiqueta="Total" valor={formatearCentavos(venta.totalCentavos)} tabular />
          <Fila etiqueta="Pago" valor={medios.length > 0 ? medios : 'Sin pago'} />
          <Fila etiqueta="Recibido" valor={formatearCentavos(recibidoCentavos)} tabular />
        </dl>

        <div className="flex flex-wrap items-center gap-[var(--space-md)]">
          <Button
            type="button"
            onClick={onNuevaVenta}
            className="flex min-h-[4rem] min-w-[18rem] items-center justify-center gap-[var(--space-sm)] rounded-lg bg-primary px-[var(--space-lg)] text-sm font-bold tracking-[0.04em] text-primary-foreground transition-transform duration-150 ease-out hover:bg-accent hover:text-accent-foreground active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <Plus aria-hidden="true" className="size-[1.125rem]" />
            Nueva venta
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="flex min-h-[4rem] items-center justify-center gap-[var(--space-sm)] rounded-lg px-[var(--space-lg)] text-[0.8125rem] font-semibold"
          >
            <Printer aria-hidden="true" className="size-4" />
            Imprimir ticket
          </Button>
        </div>
      </div>

      <aside
        aria-labelledby="ticket-preview-titulo"
        className="grid content-center justify-items-center gap-[var(--space-md)] border-t border-border bg-muted px-[var(--page-margin-desktop)] py-[var(--space-lg)] md:border-l md:border-t-0"
      >
        <span
          id="ticket-preview-titulo"
          className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground"
        >
          Ticket de 80 mm · 72 mm útiles
        </span>

        {/* El papel y su festoneado son hermanos: los dientes se dibujan sobre el fondo del stage. */}
        <div className="grid justify-items-center">
          <Ticket
            venta={venta}
            nombreTenant={nombreTenant}
            terminalId={terminalId}
            logoUrl={logoUrl}
          />
          <div aria-hidden="true" className="ticket-dientes" />
        </div>
      </aside>
    </section>
  )
}

interface FilaProps {
  readonly etiqueta: string
  readonly valor: string
  readonly tabular?: boolean
}

function Fila({ etiqueta, valor, tabular = false }: FilaProps) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
        {etiqueta}
      </dt>
      <dd className={`text-lg font-semibold leading-7 ${tabular ? 'tabular-nums' : ''}`}>
        {valor}
      </dd>
    </div>
  )
}
