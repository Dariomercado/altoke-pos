import type { ResumenTurno } from '@altoke/domain'
import { formatearCentavos } from '../formato'

export interface EncabezadoProps {
  readonly nombreTenant: string
  readonly terminalId: string
  readonly turno: ResumenTurno
  readonly onCerrarCaja: () => void
}

/** Marca del tenant y estado del turno: lo primero que mira el cajero al llegar. */
export function Encabezado({ nombreTenant, terminalId, turno, onCerrarCaja }: EncabezadoProps) {
  return (
    <header className="encabezado">
      <div className="encabezado__marca">
        <h1 className="encabezado__titulo">{nombreTenant}</h1>
        <p className="encabezado__terminal">Terminal {terminalId}</p>
      </div>

      <div className="encabezado__turno">
        <p className="encabezado__estado">{turno.abierto ? 'Turno abierto' : 'Turno cerrado'}</p>
        <p className="encabezado__total">
          Total del turno:{' '}
          <strong data-testid="total-turno">{formatearCentavos(turno.totalCentavos)}</strong>
        </p>
        {turno.abierto && (
          <button type="button" className="boton boton--secundario" onClick={onCerrarCaja}>
            Cerrar caja
          </button>
        )}
      </div>
    </header>
  )
}
