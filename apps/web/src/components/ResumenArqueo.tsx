import type { Arqueo } from '@altoke/domain'
import { formatearCentavos } from '../formato'
import { VeredictoArqueo } from './bandeja/VeredictoArqueo'

export interface ResumenArqueoProps {
  readonly arqueo: Arqueo
}

/**
 * Arqueo tal como lo lee el cajero: lo esperado sale del libro, lo contado del cajón, y el veredicto
 * cierra el bloque con la palabra y el signo además del color.
 *
 * Es el mismo bloque que usa el cierre en curso, así que el "Último cierre" se lee igual que el
 * cierre que se acaba de confirmar: esperado, contado, diferencia y estado.
 */
export function ResumenArqueo({ arqueo }: ResumenArqueoProps) {
  return (
    <div className="grid gap-[var(--space-md)]">
      <dl className="grid">
        <div className={FILA}>
          <dt className={ETIQUETA}>Esperado</dt>
          <dd className={IMPORTE}>{formatearCentavos(arqueo.esperadoCentavos)}</dd>
        </div>
        <div className={FILA}>
          <dt className={ETIQUETA}>Contado</dt>
          <dd className={IMPORTE}>{formatearCentavos(arqueo.contadoCentavos)}</dd>
        </div>
        <div className={FILA}>
          <dt className={ETIQUETA}>Diferencia</dt>
          <dd className={IMPORTE}>{formatearCentavos(arqueo.diferenciaCentavos)}</dd>
        </div>
      </dl>

      <VeredictoArqueo arqueo={arqueo} />
    </div>
  )
}

const FILA =
  'flex items-baseline justify-between gap-[var(--space-md)] border-b border-border py-[var(--space-sm)]'
const ETIQUETA = 'text-[0.8125rem] leading-5 text-muted-foreground'
const IMPORTE = 'text-[0.9375rem] font-semibold tabular-nums'
