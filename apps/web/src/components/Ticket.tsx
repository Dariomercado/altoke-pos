import type { MedioPago } from '@altoke/domain'
import { formatearCentavos, formatearFechaHora } from '../formato'
import { importeLineaCentavos } from '../pos/venta'
import type { VentaCobrada } from '../pos/caja'

export interface TicketProps {
  readonly venta: VentaCobrada
  readonly nombreTenant: string
  readonly terminalId: string
  /** El logo del tenant, impreso arriba. Sale en el ticket igual que en la pantalla. */
  readonly logoUrl?: string | undefined
}

const ETIQUETA_MEDIO: Readonly<Record<MedioPago, string>> = {
  efectivo: 'Efectivo',
  tarjeta_manual: 'Tarjeta',
  transferencia: 'Transferencia',
  qr: 'QR',
}

/**
 * Ticket de 80 mm.
 *
 * Es un **ticket interno** (modo F0 de `0002` §2): no lleva numeración fiscal, no se llama
 * factura, y declara por escrito que no es comprobante válido. Ese texto no es decorativo: es lo
 * que separa un demo vendible de un instrumento de incumplimiento.
 *
 * El CSS de impresión vive en `styles/ticket.css`: al imprimir, esto es lo único que sale en
 * pantalla, a 72 mm de ancho útil dentro de un papel de 80 mm.
 */
export function Ticket({ venta, nombreTenant, terminalId, logoUrl }: TicketProps) {
  return (
    <section className="ticket" aria-label="Ticket de la venta">
      <header className="ticket__cabecera">
        {logoUrl !== undefined && <img className="ticket__logo" src={logoUrl} alt="" />}
        <p className="ticket__marca">{nombreTenant}</p>
        <p>Terminal {terminalId}</p>
        <p>{formatearFechaHora(venta.ocurridoEn)}</p>
      </header>

      <ul className="ticket__items">
        {venta.lineas.map((linea) => (
          <li key={linea.sku} className="ticket__item">
            <span className="ticket__detalle">
              {linea.nombre} × {linea.cantidad}
            </span>
            <span className="ticket__importe">
              {formatearCentavos(importeLineaCentavos(linea))}
            </span>
          </li>
        ))}
      </ul>

      <p className="ticket__total">
        <span>TOTAL</span>
        <strong>{formatearCentavos(venta.totalCentavos)}</strong>
      </p>

      <ul className="ticket__pagos">
        {venta.pagos.map((pago, indice) => (
          <li key={`${pago.medio}-${indice}`} className="ticket__pago">
            <span>{ETIQUETA_MEDIO[pago.medio]}</span>
            <span>{formatearCentavos(pago.montoCentavos)}</span>
          </li>
        ))}
      </ul>

      {venta.cambioCentavos > 0 && (
        <p className="ticket__cambio">
          <span>Cambio</span>
          <span>{formatearCentavos(venta.cambioCentavos)}</span>
        </p>
      )}

      <p className="ticket__leyenda">TICKET INTERNO — no es comprobante fiscal válido</p>

      <div className="ticket__acciones">
        <button type="button" className="boton boton--secundario" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
    </section>
  )
}
