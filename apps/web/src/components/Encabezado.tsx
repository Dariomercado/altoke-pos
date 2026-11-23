import { createElement } from 'react'
import type { ResumenTurno } from '@altoke/domain'
import { Lock, LogOut, Palette } from 'lucide-react'
import type { Rol } from '../sesion'
import type { EstadoSync } from '../sync'
import { formatearCentavos } from '../formato'
import { logoDeMarca } from '../marca'

export interface EncabezadoProps {
  readonly nombreTenant: string
  readonly terminalId: string
  readonly turno: ResumenTurno
  readonly estadoSync: EstadoSync
  readonly rol: Rol
  readonly puedeAdministrarMarca: boolean
  readonly puedeCerrarCaja: boolean
  readonly onAbrirMarca: () => void
  readonly onCerrarCaja: () => void
  readonly onSalir: () => void
  /** Logo del tenant: el quinto hueco de marca (`--brand-logo`) hecho visible. */
  readonly logoUrl?: string | undefined
}

const NOMBRE_ROL: Readonly<Record<Rol, string>> = {
  owner: 'Dueño',
  admin: 'Administrador',
  cajero: 'Cajero',
  solo_lectura: 'Sólo lectura',
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
  estadoSync,
  rol,
  puedeAdministrarMarca,
  puedeCerrarCaja,
  onAbrirMarca,
  onCerrarCaja,
  onSalir,
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
        <p className="truncate text-xs text-muted-foreground">
          Terminal {terminalId} · {NOMBRE_ROL[rol]}
        </p>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-[var(--space-md)]">
        <ChipDeSync estado={estadoSync} />

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

        {puedeAdministrarMarca && (
          <button type="button" className={BOTON_DEL_ENCABEZADO} onClick={onAbrirMarca}>
            <Palette aria-hidden="true" className="size-4" />
            Marca
          </button>
        )}

        {puedeCerrarCaja && turno.abierto && (
          <button type="button" className={BOTON_DEL_ENCABEZADO} onClick={onCerrarCaja}>
            <Lock aria-hidden="true" className="size-4" />
            Cerrar caja
          </button>
        )}

        <button type="button" className={BOTON_DEL_ENCABEZADO} onClick={onSalir}>
          <LogOut aria-hidden="true" className="size-4" />
          Salir
        </button>
      </div>
    </header>
  )
}

/**
 * El estado del sync es un reporte, no una compuerta: no deshabilita botones ni tapa la venta.
 * `pendiente` y `sin_red` dicen cuántos eventos esperan, que es lo que el cajero puede notar.
 */
function ChipDeSync({ estado }: { readonly estado: EstadoSync }) {
  const vista = vistaDeSync(estado)

  return (
    <span
      data-testid="sync"
      aria-live="polite"
      title={vista.detalle}
      className={`inline-flex min-h-[var(--size-touch-min)] items-center gap-[var(--space-sm)] rounded-full px-[var(--space-md)] text-xs font-semibold tracking-[0.02em] ${vista.clases}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${vista.punto}`} />
      {vista.texto}
    </span>
  )
}

interface VistaDeSync {
  readonly texto: string
  readonly clases: string
  readonly punto: string
  readonly detalle: string
}

function vistaDeSync(estado: EstadoSync): VistaDeSync {
  switch (estado.tipo) {
    case 'sin_sesion':
      return {
        texto: 'Sin sesión',
        clases: 'bg-sunken text-muted-foreground',
        punto: 'bg-muted-foreground',
        detalle: 'No hay una sesión activa: el sync espera.',
      }
    case 'sincronizando':
      return {
        texto: 'Sincronizando…',
        clases: 'bg-accent text-accent-foreground',
        punto: 'bg-primary',
        detalle: 'Empujando lo pendiente y trayendo lo de las otras terminales.',
      }
    case 'al_dia':
      return {
        texto: 'Al día',
        clases: 'bg-success-soft text-success-soft-foreground',
        punto: 'bg-success',
        detalle: 'El servidor ya acusó todo lo de esta terminal.',
      }
    case 'pendiente':
      return {
        texto: `Pendiente · ${estado.pendientes}`,
        clases: 'bg-accent text-accent-foreground',
        punto: 'bg-primary',
        detalle: `${estado.pendientes} evento(s) esperando subir. La venta sigue en el libro local.`,
      }
    case 'sin_red':
      return {
        texto:
          estado.pendientes === 0
            ? 'Sin red'
            : `Sin red · ${estado.pendientes} pendiente${estado.pendientes === 1 ? '' : 's'}`,
        clases: 'bg-danger-soft text-danger-soft-foreground',
        punto: 'bg-destructive',
        detalle: 'No se pudo hablar con el servidor. El POS cobra igual.',
      }
  }
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
