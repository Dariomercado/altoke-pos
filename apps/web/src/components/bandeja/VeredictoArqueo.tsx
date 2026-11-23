import { CheckCircle2, TriangleAlert } from 'lucide-react'
import type { Arqueo } from '@altoke/domain'
import { formatearCentavos } from '../../formato'

export interface VeredictoArqueoProps {
  readonly arqueo: Arqueo
}

/**
 * El veredicto del arqueo en un bloque destacado: **la palabra y el monto**, siempre juntos.
 *
 * El estado nunca se comunica sólo por color: `faltante` y `sobrante` van con la tinta de error
 * sobre el contenedor de error, `cuadrado` con la de éxito, y en los tres casos la palabra se
 * escribe y el importe lleva signo. El `−` lo pone el formateador (la plata se formatea en un solo
 * lugar, `formato.ts`); el `+` del sobrante se agrega acá porque Intl nunca lo imprime para un
 * positivo y sin él el signo quedaría implícito.
 *
 * `role="status"` hace que el lector de pantalla anuncie el cambio de veredicto mientras el cajero
 * carga unidades, sin robarle el foco al conteo.
 */
export function VeredictoArqueo({ arqueo }: VeredictoArqueoProps) {
  const cuadrado = arqueo.estado === 'cuadrado'
  const monto = formatearCentavos(Math.abs(arqueo.diferenciaCentavos))
  const signo = arqueo.estado === 'sobrante' ? '+' : ''

  return (
    <div
      role="status"
      className={`grid gap-[var(--space-xs)] rounded-lg border p-[var(--space-md)] ${
        cuadrado
          ? 'border-success bg-success-soft text-success-soft-foreground'
          : 'border-destructive bg-danger-soft text-danger-soft-foreground'
      }`}
    >
      <span className="flex items-center gap-[var(--space-sm)] text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em]">
        {cuadrado ? (
          <CheckCircle2 aria-hidden="true" className="size-3.5" />
        ) : (
          <TriangleAlert aria-hidden="true" className="size-3.5" />
        )}
        {arqueo.estado}
      </span>

      <b className="font-sans text-[2rem] font-bold leading-[2.5rem] tracking-[-0.02em] tabular-nums">
        {signo}
        {formatearCentavos(arqueo.diferenciaCentavos)}
      </b>

      <span className="text-xs leading-4">{textoDeAyuda(arqueo.estado, monto)}</span>
    </div>
  )
}

function textoDeAyuda(estado: Arqueo['estado'], monto: string): string {
  if (estado === 'cuadrado') return 'La caja cierra exacta contra lo esperado.'

  return estado === 'faltante'
    ? `Hay ${monto} menos que lo esperado. Revisá el conteo antes de cerrar.`
    : `Hay ${monto} más que lo esperado. Revisá el conteo antes de cerrar.`
}
