import type { Membresia, Rol, Usuario } from '../../sesion'
import { Button } from '../ui/button'
import { MarcoDeSesion, MarcaDeSesion } from './MarcoDeSesion'

export interface SelectorTenantProps {
  readonly usuario: Usuario
  readonly membresias: readonly Membresia[]
  readonly onElegir: (membresia: Membresia) => void | Promise<void>
  readonly onSalir: () => void | Promise<void>
}

const NOMBRE_ROL: Readonly<Record<Rol, string>> = {
  owner: 'Dueño',
  admin: 'Administrador',
  cajero: 'Cajero',
  solo_lectura: 'Sólo lectura',
}

/**
 * Con más de una membresía el cliente **nombra el tenant**: el servidor no elige por el usuario y
 * el POS tampoco. No hay opción preseleccionada; entrar es tocar explícitamente el kiosco.
 */
export function SelectorTenant({ usuario, membresias, onElegir, onSalir }: SelectorTenantProps) {
  return (
    <MarcoDeSesion>
      <MarcaDeSesion />
      <h1 className="mt-[var(--space-lg)] font-sans text-[1.75rem] font-bold leading-9 tracking-[-0.02em]">
        ¿En qué kiosco vas a trabajar?
      </h1>
      <p className="mt-[var(--space-xs)] text-sm leading-5 text-muted-foreground">
        {usuario.nombre}, tu cuenta pertenece a más de un local. Elegí uno para esta terminal.
      </p>

      <ul className="mt-[var(--space-lg)] grid gap-[var(--space-sm)]">
        {membresias.map((membresia) => (
          <li key={membresia.tenantId}>
            <button
              type="button"
              onClick={() => {
                void onElegir(membresia)
              }}
              className="flex min-h-[var(--size-touch-min)] w-full items-center justify-between gap-[var(--space-md)] rounded-md border border-border bg-muted px-[var(--space-md)] py-[var(--space-sm)] text-left transition-colors hover:border-primary hover:bg-accent"
            >
              <span>
                <span className="block text-base font-semibold text-foreground">
                  {membresia.nombre}
                </span>
                <span className="block text-xs text-muted-foreground">{membresia.slug}</span>
              </span>
              <span className="rounded-full bg-card px-[var(--space-sm)] py-0.5 text-xs font-semibold text-muted-foreground">
                {NOMBRE_ROL[membresia.rol]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-[var(--space-lg)] border-t border-border pt-[var(--space-md)]">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            void onSalir()
          }}
          className="min-h-[var(--size-touch-min)] w-full justify-center rounded-md text-sm font-semibold text-muted-foreground"
        >
          Cerrar sesión
        </Button>
      </div>
    </MarcoDeSesion>
  )
}
