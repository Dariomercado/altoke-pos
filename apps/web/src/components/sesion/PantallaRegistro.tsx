import { useState } from 'react'
import type { FormEvent } from 'react'
import type { DatosDeRegistro, ErrorDeSesion } from '../../sesion'
import { Button } from '../ui/button'
import { AvisoDeSesion, CampoDeSesion, MarcoDeSesion, MarcaDeSesion } from './MarcoDeSesion'

export interface PantallaRegistroProps {
  readonly aviso?: ErrorDeSesion | null
  readonly onCrear: (datos: DatosDeRegistro) => Promise<ErrorDeSesion | null>
  readonly onVolver: () => void
}

/**
 * Alta del tenant y de su dueño en una sola pantalla: nombre del kiosco, slug, nombre del dueño,
 * email y contraseña. El slug es la dirección del local (`slug.altoke.app`) y el servidor lo valida
 * igual que el resto; acá sólo se muestra para que se entienda qué se está eligiendo.
 */
export function PantallaRegistro({ aviso = null, onCrear, onVolver }: PantallaRegistroProps) {
  const [nombreKiosco, setNombreKiosco] = useState('')
  const [slug, setSlug] = useState('')
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ErrorDeSesion | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function crear(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    setEnviando(true)
    setError(null)

    try {
      setError(
        await onCrear({
          nombre,
          email,
          password,
          tenant: { nombre: nombreKiosco, slug },
        }),
      )
    } finally {
      setEnviando(false)
    }
  }

  return (
    <MarcoDeSesion>
      <MarcaDeSesion inicial={nombreKiosco.trim() === '' ? 'A' : nombreKiosco.trim()} />
      <h1 className="mt-[var(--space-lg)] font-sans text-[1.75rem] font-bold leading-9 tracking-[-0.02em]">
        Creá la cuenta de tu kiosco
      </h1>
      <p className="mt-[var(--space-xs)] text-sm leading-5 text-muted-foreground">
        Tu local, tu catálogo y tu marca. La cuenta queda como dueño del kiosco.
      </p>

      <form
        aria-label="Crear cuenta del kiosco"
        onSubmit={(evento) => {
          void crear(evento)
        }}
        className="mt-[var(--space-lg)] grid gap-[var(--space-md)]"
      >
        <CampoDeSesion
          etiqueta="Nombre del kiosco"
          valor={nombreKiosco}
          onChange={setNombreKiosco}
        />
        <CampoDeSesion
          etiqueta="Dirección del kiosco"
          valor={slug}
          autoComplete="off"
          ayuda={
            slug.trim() === ''
              ? 'Minúsculas, números y guiones. Es la dirección de tu local.'
              : `Tu local va a vivir en ${slug.trim().toLowerCase()}.altoke.app`
          }
          onChange={(valor) => setSlug(valor.toLowerCase())}
        />
        <CampoDeSesion
          etiqueta="Tu nombre"
          valor={nombre}
          autoComplete="name"
          onChange={setNombre}
        />
        <CampoDeSesion
          etiqueta="Email"
          tipo="email"
          autoComplete="username"
          valor={email}
          onChange={setEmail}
        />
        <CampoDeSesion
          etiqueta="Contraseña"
          tipo="password"
          autoComplete="new-password"
          ayuda="Entre 8 y 200 caracteres."
          valor={password}
          onChange={setPassword}
        />

        <AvisoDeSesion error={error ?? aviso} />

        <Button
          type="submit"
          disabled={enviando}
          className="min-h-[var(--size-touch-min)] w-full rounded-md bg-primary px-[var(--space-lg)] text-sm font-bold tracking-[0.04em] text-primary-foreground"
        >
          {enviando ? 'Creando…' : 'Crear cuenta y entrar'}
        </Button>
      </form>

      <p className="mt-[var(--space-lg)] border-t border-border pt-[var(--space-md)] text-sm text-muted-foreground">
        ¿Ya tenés cuenta?{' '}
        <button
          type="button"
          onClick={onVolver}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Volver al login
        </button>
      </p>
    </MarcoDeSesion>
  )
}
