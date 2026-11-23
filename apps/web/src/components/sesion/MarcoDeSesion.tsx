/**
 * Piezas comunes de las pantallas de sesión.
 *
 * La primera pantalla que ve el dueño del kiosco no puede parecer un panel de administración:
 * una tarjeta chica sobre la superficie del sistema, la marca del local, un titular claro y un
 * solo botón primario. Se usan los mismos tokens y clases que el POS rediseñado (`bg-card`,
 * `bg-muted`, `--space-*`, `min-h-[var(--size-touch-min)]`).
 */

import type { ReactNode } from 'react'
import type { ErrorDeSesion } from '../../sesion'

export function MarcoDeSesion({ children }: { readonly children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted px-[var(--page-margin)] py-[var(--space-xl)]">
      <div className="w-full max-w-[28rem] rounded-lg border border-border bg-card p-[var(--space-xl)] text-foreground shadow-[var(--shadow-panel)]">
        {children}
      </div>
    </main>
  )
}

/** Cuadrado de marca: el mismo hueco `primary` que pinta la acción principal del POS. */
export function MarcaDeSesion({ inicial = 'A' }: { readonly inicial?: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-12 place-items-center rounded-lg bg-primary font-sans text-xl font-bold text-primary-foreground"
    >
      {inicial.slice(0, 1).toUpperCase()}
    </span>
  )
}

export interface CampoDeSesionProps {
  readonly etiqueta: string
  readonly valor: string
  readonly tipo?: 'text' | 'email' | 'password'
  readonly autoComplete?: string
  readonly ayuda?: string
  readonly requerido?: boolean
  readonly onChange: (valor: string) => void
}

export function CampoDeSesion({
  etiqueta,
  valor,
  tipo = 'text',
  autoComplete,
  ayuda,
  requerido = true,
  onChange,
}: CampoDeSesionProps) {
  return (
    <label className="grid gap-[var(--space-xs)]">
      <span className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
        {etiqueta}
      </span>
      <input
        type={tipo}
        value={valor}
        required={requerido}
        autoComplete={autoComplete}
        onChange={(evento) => onChange(evento.target.value)}
        className="min-h-[var(--size-touch-min)] w-full rounded-md border border-input bg-muted px-[var(--space-md)] text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-input"
      />
      {ayuda !== undefined && (
        <span className="text-xs leading-4 text-muted-foreground">{ayuda}</span>
      )}
    </label>
  )
}

export function AvisoDeSesion({ error }: { readonly error: ErrorDeSesion | null }) {
  if (error === null) return null

  return (
    <p
      role="alert"
      className="rounded-md border border-destructive bg-danger-soft px-[var(--space-sm)] py-[var(--space-sm)] text-sm leading-5 text-danger-soft-foreground"
    >
      {error.mensaje}
    </p>
  )
}
