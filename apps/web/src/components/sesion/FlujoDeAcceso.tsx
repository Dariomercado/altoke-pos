import { useState } from 'react'
import type { AccionesDeSesion, ErrorDeSesion } from '../../sesion'
import { PantallaLogin } from './PantallaLogin'
import { PantallaRegistro } from './PantallaRegistro'

export interface FlujoDeAccesoProps {
  readonly aviso?: ErrorDeSesion | null
  readonly onEntrar: AccionesDeSesion['iniciarSesion']
  readonly onRegistrar: AccionesDeSesion['registrar']
}

/** Login y alta comparten el aviso del arranque; cambiar de modo no pierde el contexto. */
export function FlujoDeAcceso({ aviso = null, onEntrar, onRegistrar }: FlujoDeAccesoProps) {
  const [modo, setModo] = useState<'login' | 'registro'>('login')

  return modo === 'login' ? (
    <PantallaLogin
      aviso={aviso}
      onEntrar={onEntrar}
      onIrARegistro={() => setModo('registro')}
    />
  ) : (
    <PantallaRegistro
      aviso={aviso}
      onCrear={onRegistrar}
      onVolver={() => setModo('login')}
    />
  )
}
