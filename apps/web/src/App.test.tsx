// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { crearStoreEnMemoria } from '@altoke/store'
import { App } from './App'
import { CATALOGO } from './catalogo'
import { formatearCentavos } from './formato'

const alfajor = CATALOGO.find((producto) => producto.sku === 'alfajor')

if (alfajor === undefined) {
  throw new Error('El catálogo de prueba necesita un alfajor')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function abrirCaja(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Abrir caja' }))
  await screen.findByText(/turno abierto/i)
}

/** La teja del alfajor: el botón de la grilla, no los +/- de la venta. */
function tejaDeAlfajor(): HTMLElement {
  return screen.getByRole('button', { name: /^Alfajor triple/ })
}

describe('POS — abrir la caja', () => {
  it('arranca pidiendo el fondo del turno antes que nada', async () => {
    render(<App store={crearStoreEnMemoria()} />)

    const fondo = await screen.findByLabelText('Fondo inicial en pesos')

    expect((fondo as HTMLInputElement).value).toBe('50,00')
    expect(screen.getByText(/turno cerrado/i)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Productos' })).toBeNull()
  })

  it('abre el turno con el fondo que escribe el cajero', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    const fondo = await screen.findByLabelText('Fondo inicial en pesos')
    await user.clear(fondo)
    await user.type(fondo, '100')
    await user.click(screen.getByRole('button', { name: 'Abrir caja' }))

    expect(await screen.findByText(/turno abierto/i)).toBeDefined()
    expect(screen.getByTestId('total-turno').textContent).toBe(formatearCentavos(0))
    expect(await screen.findByRole('region', { name: 'Productos' })).toBeDefined()
  })
})

describe('POS — cobrar e imprimir', () => {
  it('cobra dos alfajores en efectivo exacto y muestra el ticket interno', async () => {
    const user = userEvent.setup()
    const imprimir = vi.spyOn(window, 'print').mockImplementation(() => {})

    render(<App store={crearStoreEnMemoria()} />)
    await abrirCaja(user)

    const tejaAlfajor = tejaDeAlfajor()
    expect(tejaAlfajor.textContent).toContain('Stock: 24')

    await user.click(tejaAlfajor)
    await user.click(tejaAlfajor)

    const totalEsperado = formatearCentavos(alfajor.precioUnitarioCentavos * 2)
    expect(screen.getByTestId('total-venta').textContent).toBe(totalEsperado)

    const efectivo = screen.getByLabelText('Efectivo recibido en pesos')
    expect((efectivo as HTMLInputElement).value).toBe('24,20')

    await user.click(screen.getByRole('button', { name: 'Cobrar' }))

    const ticket = await screen.findByRole('region', { name: 'Ticket de la venta' })
    expect(ticket.textContent).toContain('24,20')
    expect(ticket.textContent).toContain('Alfajor')
    expect(ticket.textContent).toContain('Efectivo')
    expect(ticket.textContent).toContain('TICKET INTERNO — no es comprobante fiscal válido')

    await waitFor(() => {
      expect(tejaDeAlfajor().textContent).toContain('Stock: 22')
    })
    expect(screen.getByTestId('total-turno').textContent).toBe(totalEsperado)

    await user.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('un pago insuficiente muestra el error y no confirma nada', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)
    await abrirCaja(user)

    await user.click(tejaDeAlfajor())
    await user.click(tejaDeAlfajor())

    const efectivo = screen.getByLabelText('Efectivo recibido en pesos')
    await user.clear(efectivo)
    await user.type(efectivo, '20')
    await user.click(screen.getByRole('button', { name: 'Cobrar' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Faltan cobrar')
    expect(screen.queryByRole('region', { name: 'Ticket de la venta' })).toBeNull()
    expect(screen.getByTestId('total-turno').textContent).toBe(formatearCentavos(0))
    expect(tejaDeAlfajor().textContent).toContain('Stock: 24')
  })

  it('cobra con tarjeta manual sin pedir efectivo ni dar cambio', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)
    await abrirCaja(user)

    await user.click(tejaDeAlfajor())
    await user.click(screen.getByLabelText('Tarjeta (manual)'))
    await user.click(screen.getByRole('button', { name: 'Cobrar' }))

    const ticket = await screen.findByRole('region', { name: 'Ticket de la venta' })
    expect(ticket.textContent).toContain('Tarjeta')
    expect(ticket.textContent).not.toContain('Cambio')
  })
})

describe('POS — cerrar la caja', () => {
  it('muestra el arqueo del cajón y cierra el turno', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)
    await abrirCaja(user)

    await user.click(screen.getByRole('button', { name: 'Cerrar caja' }))

    const panel = await screen.findByRole('region', { name: 'Cerrar caja' })
    // El turno abrió con 50 pesos de fondo: el cajón vacío es un faltante de todo el fondo.
    expect(panel.textContent).toContain('faltante')
    expect(panel.textContent).toContain(formatearCentavos(5000))

    const cuentaDeCincuenta = screen.getByRole('spinbutton', { name: 'Cantidad de 5000 centavos' })
    await user.clear(cuentaDeCincuenta)
    await user.type(cuentaDeCincuenta, '1')

    expect(panel.textContent).toContain('cuadrado')

    await user.click(screen.getByRole('button', { name: 'Confirmar cierre' }))

    expect(await screen.findByText(/turno cerrado/i)).toBeDefined()
    const ultimoCierre = await screen.findByRole('region', { name: 'Último cierre' })
    expect(ultimoCierre.textContent).toContain('cuadrado')
    expect(screen.getByRole('button', { name: 'Abrir caja' })).toBeDefined()
  })
})
