import type { Arqueo } from '@altoke/domain'
import { formatearCentavos } from '../formato'

export interface ResumenArqueoProps {
  readonly arqueo: Arqueo
}

/**
 * Arqueo tal como lo lee el cajero: lo esperado sale del libro, lo contado del cajón, y el estado
 * es la comparación. La diferencia lleva signo porque un faltante es la cifra que hay que explicar.
 */
export function ResumenArqueo({ arqueo }: ResumenArqueoProps) {
  return (
    <dl className="arqueo">
      <div className="arqueo__fila">
        <dt>Esperado</dt>
        <dd>{formatearCentavos(arqueo.esperadoCentavos)}</dd>
      </div>
      <div className="arqueo__fila">
        <dt>Contado</dt>
        <dd>{formatearCentavos(arqueo.contadoCentavos)}</dd>
      </div>
      <div className="arqueo__fila">
        <dt>Diferencia</dt>
        <dd>{formatearCentavos(arqueo.diferenciaCentavos)}</dd>
      </div>
      <div className={`arqueo__fila arqueo__fila--${arqueo.estado}`}>
        <dt>Estado</dt>
        <dd>{arqueo.estado}</dd>
      </div>
    </dl>
  )
}
