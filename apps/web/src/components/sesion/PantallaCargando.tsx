import { MarcoDeSesion, MarcaDeSesion } from './MarcoDeSesion'

/** Mientras se lee IndexedDB y se confirma `/auth/yo`: ni login ni POS, sólo la espera. */
export function PantallaCargando() {
  return (
    <MarcoDeSesion>
      <MarcaDeSesion />
      <h1 className="mt-[var(--space-lg)] font-sans text-[1.75rem] font-bold leading-9 tracking-[-0.02em]">
        Abriendo tu kiosco…
      </h1>
      <p role="status" className="mt-[var(--space-xs)] text-sm leading-5 text-muted-foreground">
        Buscando la última sesión de esta terminal.
      </p>
    </MarcoDeSesion>
  )
}
