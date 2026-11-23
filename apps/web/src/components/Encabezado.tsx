import { createElement } from 'react'
import type { ResumenTurno } from '@altoke/domain'
import { LogOut, Palette } from 'lucide-react'
import { formatearCentavos } from '../formato'
import { logoDeMarca } from '../marca'

export interface EncabezadoProps {
  readonly nombreTenant: string
  readonly terminalId: string
  readonly turno: ResumenTurno
  readonly onAbrirMarca: () => void
  readonly onCerrarCaja: () => void
  /** Logo del tenant: el quinto hueco de marca (`--brand-logo`) hecho visible. */
  readonly logoUrl?: string | undefined
}

/**
 * Barra superior del POS: marca del tenant, kiosco, terminal y estado del turno.
 *
 * Es lo primero que mira el cajero al llegar, así que el turno va como estado explícito
 * ("Turno abierto" / "Turno cerrado") y no sólo por color: el texto es lo que se lee de lejos y
 * lo que anuncia el lector de pantalla.
 */
export function Encabezado({
  nombreTenant,
  terminalId,
  turno,
  onAbrirMarca,
  onCerrarCaja,
  logoUrl,
}: EncabezadoProps) {
  // Un logo en blanco es "sin logo": sin `<img src="">` y sin el warning de React.
  const logo = logoDeMarca(logoUrl)

  return (
    <header className="flex h-[var(--size-header)] shrink-0 items-center gap-[var(--space-md)] border-b border-border bg-card px-[var(--page-margin-desktop)] py-[var(--space-sm)]">
      {logo === undefined ? (
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-md bg-primary font-sans text-base font-bold text-primary-foreground"
        >
          {nombreTenant.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <LogoDeMarca src={logo} alt={`Logo de ${nombreTenant}`} />
      )}

      <div className="min-w-0">
        <p className="truncate font-sans text-base font-semibold leading-5 tracking-[-0.01em]">
          {nombreTenant}
        </p>
        <p className="truncate text-xs text-muted-foreground">Terminal {terminalId}</p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-[var(--space-md)]">
        <span
          className={`inline-flex min-h-[var(--size-touch-min)] items-center gap-[var(--space-sm)] rounded-full px-[var(--space-md)] text-xs font-semibold tracking-[0.02em] ${
            turno.abierto
              ? 'bg-success-soft text-success-soft-foreground'
              : 'bg-sunken text-muted-foreground'
          }`}
        >
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${turno.abierto ? 'bg-success' : 'bg-muted-foreground'}`}
          />
          {turno.abierto ? 'Turno abierto' : 'Turno cerrado'}
        </span>

        <p className="text-sm text-muted-foreground">
          Total del turno{' '}
          <strong
            className="text-base font-semibold text-foreground tabular-nums"
            data-testid="total-turno"
          >
            {formatearCentavos(turno.totalCentavos)}
          </strong>
        </p>

        <button type="button" className={BOTON_DEL_ENCABEZADO} onClick={onAbrirMarca}>
          <Palette aria-hidden="true" className="size-4" />
          Marca
        </button>

        {turno.abierto && (
          <button type="button" className={BOTON_DEL_ENCABEZADO} onClick={onCerrarCaja}>
            <LogOut aria-hidden="true" className="size-4" />
            Cerrar caja
          </button>
        )}
      </div>
    </header>
  )
}

const BOTON_DEL_ENCABEZADO =
  'inline-flex min-h-[var(--size-touch-min)] items-center gap-[var(--space-sm)] rounded-md border border-border bg-card px-[var(--space-md)] text-sm font-semibold transition-transform active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100'

/**
 * El logo del tenant en el encabezado, dibujado sin `<img>`.
 *
 * `logo-de-marca` es un custom element (nombre con guion) que se pinta como **fondo** desde la URL
 * ya validada por `logoDeMarca`: el encabezado no monta una imagen del navegador. Publica `src` y
 * `alt` igual —son la identidad del logo y lo que se ve en el inspector— y `role="img"` +
 * `aria-label` es lo que anuncia el lector de pantalla: "Logo de …".
 */
function LogoDeMarca({ src, alt }: { readonly src: string; readonly alt: string }) {
  return createElement('logo-de-marca', {
    src,
    alt,
    role: 'img',
    'aria-label': alt,
    className: 'block size-9 shrink-0 rounded-md bg-contain bg-center bg-no-repeat',
    style: { backgroundImage: `url(${JSON.stringify(src)})` },
  })
}
