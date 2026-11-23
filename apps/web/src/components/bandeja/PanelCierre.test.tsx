// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DENOMINACIONES, armarArqueo, contarDenominaciones } from '@altoke/domain'
import type { ConteoPorDenominacion, ResumenTurno } from '@altoke/domain'
import { formatearCentavos } from '../../formato'
import { PanelCierre } from '../PanelCierre'

afterEach(cleanup)

/** Turno recién abierto con $50 de fondo y sin ventas: el cajón vacío falta justo el fondo. */
const TURNO_MINIMO: ResumenTurno = {
  turnoId: 'turno-1',
  abierto: true,
  fondoCentavos: 5_000,
  declaradoCentavos: null,
  ventasConfirmadas: 0,
  ventasAnuladas: 0,
  totalCentavos: 0,
  cobradoCentavos: 0,
  cobradoPorMedio: { efectivo: 0, tarjeta_manual: 0, transferencia: 0, qr: 0 },
  diferenciaCentavos: 0,
  unidadesPorSku: {},
}

/** Turno con ventas: los medios sin efectivo entran al resumen pero no al cajón. */
const TURNO_CON_VENTAS: ResumenTurno = {
  ...TURNO_MINIMO,
  fondoCentavos: 2_000_000,
  ventasConfirmadas: 34,
  totalCentavos: 12_840_000,
  cobradoCentavos: 12_840_000,
  cobradoPorMedio: {
    efectivo: 9_240_000,
    tarjeta_manual: 2_000_000,
    transferencia: 1_200_000,
    qr: 400_000,
  },
}

interface Escenario {
  readonly conteo?: ConteoPorDenominacion
  readonly turno?: ResumenTurno
  readonly error?: string | null
}

function renderCierre({ conteo = {}, turno = TURNO_MINIMO, error = null }: Escenario = {}) {
  const props = {
    denominaciones: DENOMINACIONES,
    conteo,
    turno,
    error,
    arqueo: armarArqueo({
      esperadoCentavos: turno.fondoCentavos + turno.cobradoPorMedio.efectivo,
      contadoCentavos: contarDenominaciones(conteo),
    }),
    onCambiarCantidad: vi.fn(),
    onVaciar: vi.fn(),
    onConfirmar: vi.fn(),
    onCancelar: vi.fn(),
  }

  render(<PanelCierre {...props} />)

  return props
}

function panel(): HTMLElement {
  return screen.getByRole('region', { name: 'Cerrar caja' })
}

function confirmar(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Confirmar cierre' }) as HTMLButtonElement
}

describe('cierre de caja — arqueo vacío', () => {
  it('sin unidades cargadas el contado es $ 0,00 y la diferencia se muestra completa como faltante', () => {
    renderCierre()

    expect(panel().textContent).toContain('faltante')
    expect(panel().textContent).toContain(formatearCentavos(0))
    expect(panel().textContent).toContain(formatearCentavos(-5_000))
    // Un conteo vacío no se dibuja como guion ni como un valor inventado.
    expect(panel().textContent).not.toContain('—')
  })

  it('no deja confirmar con el cajón sin contar y escribe el motivo', () => {
    renderCierre()

    expect(confirmar().disabled).toBe(true)
    expect(confirmar().getAttribute('aria-describedby')).toBe('cierre-motivo')
    expect(screen.getByText(/no cargaste ninguna unidad/i)).toBeDefined()
  })

  it('marcar el cajón vacío habilita el cierre sin inventar unidades en el conteo', async () => {
    const user = userEvent.setup()
    const props = renderCierre()

    await user.click(screen.getByRole('button', { name: 'El cajón está vacío' }))

    expect(confirmar().disabled).toBe(false)
    expect(panel().textContent).toContain(formatearCentavos(0))
    expect(panel().textContent).toContain('faltante')

    await user.click(confirmar())
    expect(props.onConfirmar).toHaveBeenCalledTimes(1)
  })
})

describe('cierre de caja — conteo por denominación', () => {
  it('los pasos suman y restan sobre la fila del billete', async () => {
    const user = userEvent.setup()
    const monto = formatearCentavos(5_000)
    const props = renderCierre({ conteo: { 5_000: 1 } })

    await user.click(screen.getByRole('button', { name: `Agregar un billete de ${monto}` }))
    expect(props.onCambiarCantidad).toHaveBeenCalledWith(5_000, 2)

    await user.click(screen.getByRole('button', { name: `Quitar un billete de ${monto}` }))
    expect(props.onCambiarCantidad).toHaveBeenCalledWith(5_000, 0)
  })

  it('en cero el paso de resta de una moneda no se puede tocar', () => {
    renderCierre()

    const quitar = screen.getByRole('button', {
      name: `Quitar una moneda de ${formatearCentavos(500)}`,
    })

    expect((quitar as HTMLButtonElement).disabled).toBe(true)
  })

  it('cada denominación conserva su cantidad editable y su subtotal', () => {
    renderCierre({ conteo: { 1_000_000: 2, 500: 3 } })

    const cantidad = screen.getByRole('spinbutton', { name: 'Cantidad de 1000000 centavos' })
    expect((cantidad as HTMLInputElement).value).toBe('2')

    expect(panel().textContent).toContain(formatearCentavos(2_000_000))
    expect(panel().textContent).toContain(formatearCentavos(1_500))
  })

  it('cuando el conteo cubre lo esperado el veredicto dice cuadrado y el cierre se confirma', async () => {
    const user = userEvent.setup()
    const props = renderCierre({ conteo: { 5_000: 1 } })

    expect(panel().textContent).toContain('cuadrado')
    expect(panel().textContent).toContain(formatearCentavos(0))
    expect(confirmar().disabled).toBe(false)

    await user.click(confirmar())
    expect(props.onConfirmar).toHaveBeenCalledTimes(1)
  })
})

describe('cierre de caja — resumen del turno', () => {
  it('muestra fondo, ventas, lo cobrado por medio y el efectivo esperado y contado', () => {
    renderCierre({ turno: TURNO_CON_VENTAS, conteo: { 1_000_000: 12, 20_000: 3 } })

    for (const etiqueta of [
      'Fondo inicial',
      'Ventas del turno',
      'Cobrado en efectivo',
      'Cobrado con QR y transferencia',
      'Efectivo esperado',
      'Efectivo contado',
    ]) {
      expect(screen.getAllByText(etiqueta).length).toBeGreaterThan(0)
    }

    const cifras = panel().textContent ?? ''
    expect(cifras).toContain(formatearCentavos(2_000_000))
    expect(cifras).toContain(formatearCentavos(12_840_000))
    expect(cifras).toContain(formatearCentavos(9_240_000))
    expect(cifras).toContain(formatearCentavos(3_600_000))
    expect(cifras).toContain(formatearCentavos(11_240_000))
    // Contado: 12 billetes de $10.000 más 3 de $200, o sea $800 más que lo esperado.
    expect(cifras).toContain(formatearCentavos(12_060_000))
    expect(cifras).toContain('sobrante')
    expect(cifras).toContain(`+${formatearCentavos(820_000)}`)
  })
})

describe('cierre de caja — tinta de las acciones', () => {
  it('«Vaciar conteo» pinta con la tinta del tema y no con el primario de marca', () => {
    renderCierre()

    const vaciar = screen.getByRole('button', { name: 'Vaciar conteo' })

    // `text-primary` escribe la marca del tenant como tinta sobre una tarjeta clara, y el guard de
    // contraste no valida --brand-primary como color de texto: una marca pastel quedaría ilegible.
    // La tinta del tema sí está cubierta por el guard.
    expect(vaciar.className).toContain('text-foreground')
    expect(vaciar.className).not.toContain('text-primary')
  })
})

describe('cierre de caja — errores de la caja', () => {
  it('el error de la caja se lee adentro de la capa del cierre', () => {
    renderCierre({ error: 'No hay turno abierto para cerrar.' })

    expect(screen.getByRole('alert').textContent).toContain('No hay turno abierto para cerrar.')
  })

  it('un error de la caja no apaga Confirmar: reintentar es lo correcto', () => {
    renderCierre({ conteo: { 5_000: 1 }, error: 'No hay turno abierto para cerrar.' })

    // El arqueo está cuadrado y lo único que falló fue la caja, así que el cajero reintenta con el
    // mismo botón: el error se lee y el cierre sigue a un toque.
    expect(confirmar().disabled).toBe(false)
    expect(screen.getByRole('alert').textContent).toContain('No hay turno abierto para cerrar.')
  })

  it('lo que bloquea Confirmar es el cajón sin contar, no el error de la caja', () => {
    renderCierre({ error: 'No hay turno abierto para cerrar.' })

    expect(confirmar().disabled).toBe(true)
    expect(confirmar().getAttribute('aria-describedby')).toBe('cierre-motivo')
    expect(screen.getByText(/no cargaste ninguna unidad/i)).toBeDefined()
  })
})
