import { useState } from 'react'
import type { Centavos } from '@altoke/domain'
import { pesosDesdeCentavos } from '../formato'

export interface AperturaCajaProps {
  readonly fondoPorDefecto: Centavos
  readonly onAbrir: (fondoPesos: string) => void
}

/** Apertura del turno: sin fondo no hay arqueo posible al cerrar. */
export function AperturaCaja({ fondoPorDefecto, onAbrir }: AperturaCajaProps) {
  const [fondoPesos, setFondoPesos] = useState(() => pesosDesdeCentavos(fondoPorDefecto))

  return (
    <section className="apertura" aria-label="Apertura de caja">
      <h2 className="apertura__titulo">Abrir caja</h2>
      <p className="apertura__ayuda">Contá el fondo con el que arranca el turno.</p>

      <label className="campo">
        <span className="campo__etiqueta">Fondo inicial ($)</span>
        <input
          className="campo__input"
          type="text"
          inputMode="decimal"
          aria-label="Fondo inicial en pesos"
          value={fondoPesos}
          onChange={(evento) => setFondoPesos(evento.target.value)}
        />
      </label>

      <button type="button" className="boton boton--primario" onClick={() => onAbrir(fondoPesos)}>
        Abrir caja
      </button>
    </section>
  )
}
