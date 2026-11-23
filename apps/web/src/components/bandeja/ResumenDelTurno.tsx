import type { Arqueo, ResumenTurno } from '@altoke/domain'
import { formatearCentavos } from '../../formato'

export interface ResumenDelTurnoProps {
  readonly turno: ResumenTurno
  readonly arqueo: Arqueo
}

const FILA =
  'flex items-baseline justify-between gap-[var(--space-md)] border-b border-border py-[var(--space-sm)]'
const ETIQUETA = 'text-[0.8125rem] leading-5 text-muted-foreground'
const IMPORTE = 'text-[0.9375rem] font-semibold tabular-nums'

/**
 * Las cifras del turno que explican el arqueo, todas del libro (`resumirTurno`): fondo inicial,
 * ventas, lo cobrado por medio, el efectivo que debería haber y el que el cajero contó.
 *
 * Separar "cobrado en efectivo" de "cobrado con QR y transferencia" no es cosmético: sólo el
 * efectivo está en el cajón, y un esperado que sume la tarjeta produce un sobrante fantasma en
 * cada cierre. Los dos medios sin efectivo se muestran juntos porque el cierre no los distingue.
 */
export function ResumenDelTurno({ turno, arqueo }: ResumenDelTurnoProps) {
  const sinEfectivo =
    turno.cobradoPorMedio.tarjeta_manual +
    turno.cobradoPorMedio.transferencia +
    turno.cobradoPorMedio.qr

  return (
    <dl className="grid content-start">
      <Cifra etiqueta="Fondo inicial" centavos={turno.fondoCentavos} />
      <Cifra etiqueta="Ventas del turno" centavos={turno.totalCentavos} />
      <Cifra etiqueta="Cobrado en efectivo" centavos={turno.cobradoPorMedio.efectivo} />
      <Cifra etiqueta="Cobrado con QR y transferencia" centavos={sinEfectivo} />
      <Cifra etiqueta="Efectivo esperado" centavos={arqueo.esperadoCentavos} grande />
      <Cifra etiqueta="Efectivo contado" centavos={arqueo.contadoCentavos} grande />
    </dl>
  )
}

function Cifra({
  etiqueta,
  centavos,
  grande = false,
}: {
  readonly etiqueta: string
  readonly centavos: number
  readonly grande?: boolean
}) {
  return (
    <div className={FILA}>
      <dt
        className={
          grande
            ? 'text-[0.75rem] font-semibold uppercase leading-4 tracking-[0.02em] text-muted-foreground'
            : ETIQUETA
        }
      >
        {etiqueta}
      </dt>
      <dd
        className={
          grande
            ? 'm-0 font-sans text-[1.5rem] font-bold leading-8 tracking-[-0.015em] tabular-nums'
            : `m-0 ${IMPORTE}`
        }
      >
        {formatearCentavos(centavos)}
      </dd>
    </div>
  )
}
