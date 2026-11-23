import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ErrorDeSesion } from '../../sesion'
import { Button } from '../ui/button'
import { AvisoDeSesion, CampoDeSesion, MarcoDeSesion, MarcaDeSesion } from './MarcoDeSesion'

export interface PantallaLoginProps {
  /** Aviso del arranque (por ejemplo, una sesión vencida) antes del primer intento. */
  readonly aviso?: ErrorDeSesion | null
  readonly onEntrar: (email: string, password: string) => Promise<ErrorDeSesion | null>
  readonly onIrARegistro: () => void
}

export function PantallaLogin({ aviso = null, onEntrar, onIrARegistro }: PantallaLoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<ErrorDeSesion | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault()
    setEnviando(true)
    setError(null)

    try {
      setError(await onEntrar(email, password))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <MarcoDeSesion>
      <MarcaDeSesion />
      <h1 className="mt-[var(--space-lg)] font-sans text-[1.75rem] font-bold leading-9 tracking-[-0.02em]">
        Entrá a tu kiosco
      </h1>
      <p className="mt-[var(--space-xs)] text-sm leading-5 text-muted-foreground">
        La caja del local, con tu catálogo y tu marca. Sin vueltas.
      </p>

      <form
        aria-label="Iniciar sesión"
        onSubmit={(evento) => {
          void entrar(evento)
        }}
        className="mt-[var(--space-lg)] grid gap-[var(--space-md)]"
      >
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
          autoComplete="current-password"
          valor={password}
          onChange={setPassword}
        />

        <AvisoDeSesion error={error ?? aviso} />

        <Button
          type="submit"
          disabled={enviando}
          className="min-h-[var(--size-touch-min)] w-full rounded-md bg-primary px-[var(--space-lg)] text-sm font-bold tracking-[0.04em] text-primary-foreground"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>

      <p className="mt-[var(--space-lg)] border-t border-border pt-[var(--space-md)] text-sm text-muted-foreground">
        ¿Es tu primer día?{' '}
        <button
          type="button"
          onClick={onIrARegistro}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          Crear la cuenta de mi kiosco
        </button>
      </p>
    </MarcoDeSesion>
  )
}
