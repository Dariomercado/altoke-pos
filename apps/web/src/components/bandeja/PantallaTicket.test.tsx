// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { formatearCentavos } from '../../formato'
import type { VentaCobrada } from '../../pos/caja'
import { PantallaTicket } from './PantallaTicket'

afterEach(cleanup)

/** Venta de $24,20 pagada con $30: el vuelto es la cifra que el cajero tiene que leer. */
const VENTA_EN_EFECTIVO: VentaCobrada = {
  ventaId: 'venta-1',
  turnoId: 'turno-1',
  lineas: [
    {
      sku: 'alfajor-triple',
      nombre: 'Alfajor Triple Guaymallén',
      cantidad: 2,
      precioUnitarioCentavos: 1_210_00,
      alicuotaBps: 2_100,
    },
  ],
  totalCentavos: 24_200,
  ivaCentavos: 0,
  netoCentavos: 24_200,
  pagos: [{ medio: 'efectivo', montoCentavos: 30_000 }],
  cambioCentavos: 5_800,
  ocurridoEn: '2026-11-22T17:32:00.000Z',
}

/** Con tarjeta el pago cubre el total exacto: no hay vuelto que dar. */
const VENTA_CON_TARJETA: VentaCobrada = {
  ...VENTA_EN_EFECTIVO,
  ventaId: 'venta-2',
  pagos: [{ medio: 'tarjeta_manual', montoCentavos: 24_200 }],
  cambioCentavos: 0,
}

function renderizar(venta: VentaCobrada, handlers?: { onNuevaVenta?: () => void }): void {
  render(
    <PantallaTicket
      venta={venta}
      nombreTenant="AlToke · Kiosco demo"
      terminalId="terminal-1"
      onNuevaVenta={handlers?.onNuevaVenta ?? (() => undefined)}
    />,
  )
}

describe('PantallaTicket — el ticket después de cobrar', () => {
  it('confirma la venta y muestra el vuelto en grande, con el ticket de 80 mm al lado', () => {
    renderizar(VENTA_EN_EFECTIVO)

    const pantalla = screen.getByRole('region', { name: 'Venta cobrada' })
    expect(pantalla.textContent).toContain('Venta cobrada')
    // El vuelto se lee de un vistazo: es la cifra que el cajero entrega.
    expect(pantalla.textContent).toContain(`Vuelto${formatearCentavos(5_800)}`)

    const ticket = screen.getByRole('region', { name: 'Ticket de la venta' })
    expect(ticket.textContent).toContain('Alfajor Triple Guaymallén')
    expect(ticket.textContent).toContain(formatearCentavos(24_200))
    expect(ticket.textContent).toContain('TICKET INTERNO — no es comprobante fiscal válido')
  })

  it('con tarjeta no inventa un vuelto: lo dice', () => {
    renderizar(VENTA_CON_TARJETA)

    const pantalla = screen.getByRole('region', { name: 'Venta cobrada' })
    expect(pantalla.textContent).toContain('con tarjeta no se da')
    expect(pantalla.textContent).not.toContain(formatearCentavos(5_800))
  })

  it('Nueva venta vuelve a la bandeja', async () => {
    const user = userEvent.setup()
    const onNuevaVenta = vi.fn()
    renderizar(VENTA_EN_EFECTIVO, { onNuevaVenta })

    await user.click(screen.getByRole('button', { name: 'Nueva venta' }))

    expect(onNuevaVenta).toHaveBeenCalledTimes(1)
  })

  it('Imprimir ticket manda a imprimir el mismo ticket que se ve', async () => {
    const user = userEvent.setup()
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    renderizar(VENTA_EN_EFECTIVO)

    await user.click(screen.getByRole('button', { name: 'Imprimir ticket' }))

    expect(imprimir).toHaveBeenCalledTimes(1)
    imprimir.mockRestore()
  })
})
