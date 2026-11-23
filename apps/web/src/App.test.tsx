// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { contraste } from '@altoke/ui'
import { crearStoreEnMemoria } from '@altoke/store'
import { App } from './App'
import { CATALOGO } from './catalogo'
import { formatearCentavos } from './formato'
import { buttonVariants } from './components/ui/button'
import tailwindCss from './styles/tailwind.css?raw'
import tokensCss from '../../../packages/ui/src/tokens.css?raw'

const alfajor = CATALOGO.find((producto) => producto.sku === 'alfajor')

if (alfajor === undefined) {
  throw new Error('El catálogo de prueba necesita un alfajor')
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

/** Declaraciones `--nombre: valor;` de un CSS, sin comentarios. La primera aparición gana. */
function declaraciones(css: string): Map<string, string> {
  const salida = new Map<string, string>()

  for (const [, nombre, valor] of css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g)) {
    if (nombre === undefined || valor === undefined) continue
    if (!salida.has(nombre)) salida.set(nombre, valor.trim())
  }

  return salida
}

const tema = declaraciones(tailwindCss)
const tokens = declaraciones(tokensCss)

/** Hex de un alias del `@theme` de Tailwind, siguiendo el `var()` que lo apunta al token. */
function hexDelAlias(alias: string): string | undefined {
  const referencia = tema.get(alias)?.match(/var\((--[a-z0-9-]+)\)/)?.[1]
  return referencia === undefined ? undefined : tokens.get(referencia)?.toLowerCase()
}

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
    await user.click(screen.getByRole('button', { name: 'Cobrar y sacar ticket' }))

    const ticket = await screen.findByRole('region', { name: 'Ticket de la venta' })
    expect(ticket.textContent).toContain('24,20')
    expect(ticket.textContent).toContain('Alfajor')
    expect(ticket.textContent).toContain('Efectivo')
    expect(ticket.textContent).toContain('TICKET INTERNO — no es comprobante fiscal válido')

    await waitFor(() => {
      expect(tejaDeAlfajor().textContent).toContain('Stock: 22')
    })
    expect(screen.getByTestId('total-turno').textContent).toBe(totalEsperado)

    await user.click(screen.getByRole('button', { name: 'Imprimir ticket' }))
    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('Nueva venta vuelve a la bandeja y no deja el ticket en pantalla', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)
    await abrirCaja(user)

    await user.click(tejaDeAlfajor())
    await user.click(screen.getByRole('button', { name: 'Cobrar' }))
    await user.click(screen.getByRole('button', { name: 'Cobrar y sacar ticket' }))

    const pantalla = await screen.findByRole('region', { name: 'Venta cobrada' })
    // El vuelto exacto se lee en la confirmación, no en el ticket chico.
    expect(pantalla.textContent).toContain(`Vuelto${formatearCentavos(0)}`)

    await user.click(screen.getByRole('button', { name: 'Nueva venta' }))

    expect(screen.queryByRole('region', { name: 'Venta cobrada' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Ticket de la venta' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeDefined()
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

    // Con el efectivo corto no hay confirmación a un toque: el botón que cierra la venta queda
    // apagado, así que el carrito no puede salir por accidente mientras se lee el error.
    const cobrar = screen.getByRole('button', { name: 'Cobrar y sacar ticket' })
    expect((cobrar as HTMLButtonElement).disabled).toBe(true)
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
    await user.click(screen.getByRole('button', { name: 'Cobrar y sacar ticket' }))

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

describe('POS — marca del tenant', () => {
  it('aplica el primario en vivo y lo persiste para el tenant', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const primario = await screen.findByLabelText('Color primario')

    fireEvent.change(primario, { target: { value: '#e11d48' } })

    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#e11d48')
    expect(localStorage.getItem('altoke:marca:kiosco-1')).toContain('#e11d48')
  })

  it('el logo del tenant se ve en el POS y en el ticket', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const logo = await screen.findByLabelText(/logo/i)

    fireEvent.change(logo, { target: { value: 'https://cdn.test/kiosco.svg' } })

    const imagen = await screen.findByAltText('Logo de AlToke · Kiosco demo')
    expect(imagen.getAttribute('src')).toBe('https://cdn.test/kiosco.svg')
    expect(document.documentElement.style.getPropertyValue('--brand-logo')).toBe(
      'https://cdn.test/kiosco.svg',
    )
  })

  it('rechaza un par texto/fondo ilegible y deja aplicada la marca anterior', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    const fondoAplicado = document.documentElement.style.getPropertyValue('--brand-surface')

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const tinta = await screen.findByLabelText('Color de texto')

    fireEvent.change(tinta, { target: { value: '#9a9a9a' } })

    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toContain('texto')
    expect(aviso.textContent).toContain('fondo')
    expect(aviso.textContent).toMatch(/\d+,\d{2}:1/)
    expect(document.documentElement.style.getPropertyValue('--brand-text')).toBe('#1b1b21')
    expect(document.documentElement.style.getPropertyValue('--brand-surface')).toBe(fondoAplicado)
    expect(localStorage.getItem('altoke:marca:kiosco-1')).toBeNull()
  })

  it('rechaza una marca oscura porque los contenedores del tema claro no la siguen', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const fondo = await screen.findByLabelText('Color de fondo')
    const tinta = await screen.findByLabelText('Color de texto')

    const fondoAplicado = document.documentElement.style.getPropertyValue('--brand-surface')
    expect(fondoAplicado).toBe('#fbf8ff')

    fireEvent.change(fondo, { target: { value: '#0b1326' } })
    fireEvent.change(tinta, { target: { value: '#dae2fd' } })

    const aviso = await screen.findByRole('alert')
    expect(aviso.textContent).toContain('contenedores')
    expect(aviso.textContent).toContain('--brand-surface')
    expect(aviso.textContent).toMatch(/\d+,\d{2}:1/)
    expect(document.documentElement.style.getPropertyValue('--brand-surface')).toBe(fondoAplicado)
    expect(document.documentElement.style.getPropertyValue('--brand-text')).toBe('#1b1b21')
    expect(localStorage.getItem('altoke:marca:kiosco-1')).toBeNull()
  })

  it('al vaciar el campo del logo la imagen del encabezado se va con él', async () => {
    const user = userEvent.setup()
    render(<App store={crearStoreEnMemoria()} />)

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const logo = await screen.findByLabelText('URL del logo')

    fireEvent.change(logo, { target: { value: 'https://cdn.test/kiosco.svg' } })
    expect(await screen.findByAltText('Logo de AlToke · Kiosco demo')).toBeDefined()

    await user.clear(logo)

    expect(screen.queryByAltText('Logo de AlToke · Kiosco demo')).toBeNull()
    // Ni un `<img src="">`: el hueco del logo se borra, no queda vacío.
    expect(document.querySelectorAll('img')).toHaveLength(0)
    expect(document.documentElement.style.getPropertyValue('--brand-logo')).toBe('')
    expect(localStorage.getItem('altoke:marca:kiosco-1')).not.toContain('logoUrl')
  })
})

/**
 * Deja la hoja de cobro abierta con una venta cargada y purga la base local del tenant
 * (`0001` §6: otra pestaña la purga al cerrar sesión).
 *
 * La pantalla de esta pestaña todavía cree que el turno está abierto, así que confirmar levanta el
 * error real de la caja («no hay turno abierto»): es el caso en que el aviso no se puede ver si se
 * pinta debajo del scrim.
 */
async function errorConLaHojaAbierta(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  const store = crearStoreEnMemoria()

  render(<App store={store} />)
  await abrirCaja(user)
  await user.click(tejaDeAlfajor())
  await user.click(screen.getByRole('button', { name: 'Cobrar' }))

  await store.limpiar()

  await user.click(screen.getByRole('button', { name: 'Cobrar y sacar ticket' }))
  await screen.findByRole('alert')

  return user
}

describe('POS — error de la caja con la hoja de cobro abierta', () => {
  it('el aviso se lee adentro de la hoja y no se repite en la página', async () => {
    await errorConLaHojaAbierta()

    const hoja = screen.getByRole('dialog')

    expect(within(hoja).getByRole('alert').textContent).toContain('No hay turno abierto')
    // La hoja tapa la pantalla de venta: un segundo aviso en la página quedaría debajo del scrim.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('con la hoja cerrada el aviso sigue en la página, como siempre', async () => {
    const user = await errorConLaHojaAbierta()

    await user.click(screen.getByRole('button', { name: 'Volver' }))

    const avisos = screen.getAllByRole('alert')
    expect(avisos).toHaveLength(1)
    expect(avisos[0]?.textContent).toContain('No hay turno abierto')

    // Ya cerrada, la hoja no guarda su propia copia: el aviso que se lee es el de la página.
    const hojaCerrada = screen.getByRole('dialog', { hidden: true })
    expect(within(hojaCerrada).queryByRole('alert', { hidden: true })).toBeNull()
  })
})

describe('POS — botón compartido', () => {
  it('el anillo de foco sale de un token del tema y se lee sobre la tarjeta', () => {
    const base = buttonVariants()

    // `ring-ring/50` componía la marca al 50% sobre blanco: 2,32:1, debajo del 3:1 de no-texto.
    // Un anillo translúcido baja el contraste con cualquier marca que elija el tenant.
    expect(base).not.toMatch(/focus-visible:ring-[a-z-]+\//)

    const anillo = /focus-visible:ring-(?!\[)([a-z-]+)/.exec(base)?.[1]
    const hexAnillo = hexDelAlias(`--color-${anillo ?? ''}`)
    const hexTarjeta = hexDelAlias('--color-card')

    expect(anillo, 'el anillo de foco no nombra un color del tema').toBeDefined()
    expect(hexAnillo, `--color-${anillo ?? ''} no resuelve a un hex de tokens.css`).toBeDefined()
    expect(hexTarjeta, '--color-card no resuelve a un hex de tokens.css').toBeDefined()
    expect(contraste(hexAnillo ?? '', hexTarjeta ?? '')).toBeGreaterThanOrEqual(3)
  })

  it('la variante secondary pinta con la tinta del tema, no con una utilidad inexistente', () => {
    const secundaria = buttonVariants({ variant: 'secondary' })

    // `text-ink` no compila a nada: no existe `--color-ink` en el tema.
    expect(tema.has('--color-ink')).toBe(false)
    expect(secundaria).not.toMatch(/\btext-ink\b/)
    expect(secundaria).toContain('text-foreground')
  })
})
