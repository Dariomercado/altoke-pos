import type { Arqueo, Centavos, ConteoPorDenominacion } from '@altoke/domain'
import { formatearCentavos } from '../formato'
import { ResumenArqueo } from './ResumenArqueo'

export interface PanelCierreProps {
  readonly denominaciones: readonly Centavos[]
  readonly conteo: ConteoPorDenominacion
  readonly arqueo: Arqueo
  readonly onCambiarCantidad: (denominacion: Centavos, cantidad: number) => void
  readonly onConfirmar: () => void
  readonly onCancelar: () => void
}

/** Cierre de turno: el cajero cuenta billete por billete y el arqueo se actualiza en vivo. */
export function PanelCierre({
  denominaciones,
  conteo,
  arqueo,
  onCambiarCantidad,
  onConfirmar,
  onCancelar,
}: PanelCierreProps) {
  return (
    <section className="cierre" aria-label="Cerrar caja">
      <h2 className="cierre__titulo">Cerrar caja</h2>
      <p className="cierre__ayuda">Anotá cuántas unidades hay de cada valor en el cajón.</p>

      <div className="cierre__denominaciones">
        {denominaciones.map((denominacion) => (
          <label key={denominacion} className="cierre__fila">
            <span className="cierre__valor">{formatearCentavos(denominacion)}</span>
            <input
              className="campo__input campo__input--cantidad"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label={`Cantidad de ${denominacion} centavos`}
              value={conteo[denominacion] ?? 0}
              onChange={(evento) =>
                onCambiarCantidad(denominacion, cantidadDesdeTexto(evento.target.value))
              }
            />
          </label>
        ))}
      </div>

      <ResumenArqueo arqueo={arqueo} />

      <div className="cierre__acciones">
        <button type="button" className="boton boton--primario" onClick={onConfirmar}>
          Confirmar cierre
        </button>
        <button type="button" className="boton boton--secundario" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </section>
  )
}

/** Un conteo vacío o inválido es cero unidades: nunca se inventa plata en el cajón. */
function cantidadDesdeTexto(texto: string): number {
  const cantidad = Number(texto)

  return Number.isInteger(cantidad) && cantidad >= 0 ? cantidad : 0
}
