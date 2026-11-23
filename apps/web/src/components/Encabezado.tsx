import type { ResumenTurno } from '@altoke/domain'
import { formatearCentavos } from '../formato'
import { logoDeMarca } from '../marca'

export interface EncabezadoProps {
  readonly nombreTenant: string
  readonly terminalId: string
  readonly turno: ResumenTurno
  readonly onAbrirMarca: () => void
  readonly onCerrarCaja: () => void
  /** Logo del tenant: el quinto hueco de marca (`--brand-logo`) hecho visible. */
  readonly logoUrl?: string | undefined
}

/** Marca del tenant y estado del turno: lo primero que mira el cajero al llegar. */
export function Encabezado({
  nombreTenant,
  terminalId,
  turno,
  onAbrirMarca,
  onCerrarCaja,
  logoUrl,
}: EncabezadoProps) {
  // Un logo en blanco es "sin logo": sin `<img src="">` y sin el warning de React.
  const logo = logoDeMarca(logoUrl)

  return (
    <header className="encabezado">
      <div className="encabezado__marca">
        {logo !== undefined && (
          <img className="encabezado__logo" src={logo} alt={`Logo de ${nombreTenant}`} />
        )}
        <h1 className="encabezado__titulo">{nombreTenant}</h1>
        <p className="encabezado__terminal">Terminal {terminalId}</p>
      </div>

      <div className="encabezado__turno">
        <p className="encabezado__estado">{turno.abierto ? 'Turno abierto' : 'Turno cerrado'}</p>
        <p className="encabezado__total">
          Total del turno:{' '}
          <strong data-testid="total-turno">{formatearCentavos(turno.totalCentavos)}</strong>
        </p>
        <button type="button" className="boton boton--secundario" onClick={onAbrirMarca}>
          Marca
        </button>
        {turno.abierto && (
          <button type="button" className="boton boton--secundario" onClick={onCerrarCaja}>
            Cerrar caja
          </button>
        )}
      </div>
    </header>
  )
}
