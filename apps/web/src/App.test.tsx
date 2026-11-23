// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { contraste } from '@altoke/ui'
import { crearStoreEnMemoria } from '@altoke/store'
import type { PosStore } from '@altoke/store'
import type { Evento } from '@altoke/domain'
import { App } from './App'
import { CATALOGO } from './catalogo'
import { formatearCentavos } from './formato'
import { buttonVariants } from './components/ui/button'
import type { Membresia, OpcionesSincronizacionApp, Rol, SesionActiva } from './sesion'
import {
  MEMBRESIA_DE_PRUEBA,
  SESION_DE_PRUEBA,
  USUARIO_DE_PRUEBA,
  almacenDeSesionEnMemoria,
  clienteDeSesionDePrueba,
} from './sesion/dobles'
import { acusesEnMemoria, transporteDePrueba } from './sync/dobles'
import type { TransporteDeSync } from './sync'
import tailwindCss from './styles/tailwind.css?raw'
import './styles/pos.css'
import tokensCss from '../../../packages/ui/src/tokens.css?raw'

const alfajor = CATALOGO.find((producto) => producto.sku === 'alfajor')

if (alfajor === undefined) {
  throw new Error('El catálogo de prueba necesita un alfajor')
}

/**
 * Dependencias del sync para los tests: transporte en memoria y acuses en memoria. Sin esto cada
 * caso intentaría hablar con la API real y con IndexedDB, que no son parte de lo que prueba.
 */
function syncDePrueba(extra: OpcionesSincronizacionApp = {}): OpcionesSincronizacionApp {
  return {
    transporte: transporteDePrueba(),
    acuses: acusesEnMemoria().acuses,
    intentos: 1,
    intervaloMs: 60_000,
    ...extra,
  }
}

interface OpcionesDeRender {
  readonly store?: PosStore
  readonly rol?: Rol
  readonly sync?: OpcionesSincronizacionApp
}

/** El POS con una sesión ya resuelta: los tests no dependen de un servidor ni de una base real. */
function renderApp({ store, rol, sync }: OpcionesDeRender = {}): ReturnType<typeof render> {
  const sesion: SesionActiva = { ...SESION_DE_PRUEBA, rol: rol ?? 'owner' }

  return render(
    <App store={store ?? crearStoreEnMemoria()} sesionInicial={sesion} sync={sync ?? syncDePrueba()} />,
  )
}

/** Un evento válido del libro de esta terminal: sirve para que el sync tenga algo pendiente. */
function eventoDeAjuste(secuencia: number): Evento {
  return {
    id: `evt-${secuencia}`,
    tenantId: SESION_DE_PRUEBA.tenant.id,
    terminalId: 'terminal-1',
    secuencia,
    ocurridoEn: '2026-11-23T10:00:00.000Z',
    schemaVersion: 1,
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta: 1,
    causa: 'compra',
  }
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

/**
 * Margen para las esperas que dependen de un trabajo asíncrono de la app.
 *
 * Cobrar y cerrar el turno escriben el libro y **después** releen la proyección para pintarla
 * (`setEstado(await caja.estado())` en `App.tsx`), con un `await` en el medio: el botón vuelve y
 * la pantalla todavía muestra el estado anterior por un instante —y, cerrando, hay un render
 * intermedio real, con el panel ya cerrado y el turno todavía abierto—. RTL espera 1 s por
 * defecto, y con la suite entera compitiendo por CPU esa ventana no alcanzaba: el cierre fallaba
 * en una de cada tantas corridas completas con «Unable to find an element with the text: /turno
 * cerrado/i».
 *
 * El margen es para el reloj de la máquina, no para la app: si el estado no llega, el test sigue
 * fallando. Se usa en las esperas que dependen del estado conciliado, no en cada `await`.
 */
const ESPERA_DE_ESTADO = { timeout: 5_000 }

/** La teja del alfajor: el botón de la grilla, no los +/- de la venta. */
function tejaDeAlfajor(): HTMLElement {
  return screen.getByRole('button', { name: /^Alfajor triple/ })
}

describe('POS — abrir la caja', () => {
  it('arranca pidiendo el fondo del turno antes que nada', async () => {
    renderApp()

    const fondo = await screen.findByLabelText('Fondo inicial en pesos')

    expect((fondo as HTMLInputElement).value).toBe('50,00')
    expect(screen.getByText(/turno cerrado/i)).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Productos' })).toBeNull()
  })

  it('abre el turno con el fondo que escribe el cajero', async () => {
    const user = userEvent.setup()
    renderApp()

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

    renderApp()
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
      expect(screen.getByTestId('total-turno').textContent).toBe(totalEsperado)
    }, ESPERA_DE_ESTADO)

    await user.click(screen.getByRole('button', { name: 'Imprimir ticket' }))
    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('Nueva venta vuelve a la bandeja y no deja el ticket en pantalla', async () => {
    const user = userEvent.setup()
    renderApp()
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
    renderApp()
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
    renderApp()
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
    renderApp()
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

    // El cierre escribe el evento y relee el libro: el panel se va antes de que la pantalla muestre
    // el turno cerrado, así que se espera el estado conciliado y no el primer render.
    expect(await screen.findByText(/turno cerrado/i, undefined, ESPERA_DE_ESTADO)).toBeDefined()
    const ultimoCierre = await screen.findByRole(
      'region',
      { name: 'Último cierre' },
      ESPERA_DE_ESTADO,
    )
    expect(ultimoCierre.textContent).toContain('cuadrado')
    expect(screen.getByRole('button', { name: 'Abrir caja' })).toBeDefined()
  })
})

describe('POS — marca del tenant', () => {
  it('aplica el primario en vivo y lo persiste para el tenant', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByRole('button', { name: 'Marca' }))
    const primario = await screen.findByLabelText('Color primario')

    fireEvent.change(primario, { target: { value: '#e11d48' } })

    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#e11d48')
    expect(localStorage.getItem('altoke:marca:kiosco-1')).toContain('#e11d48')
  })

  it('el logo del tenant se ve en el POS y en el ticket', async () => {
    const user = userEvent.setup()
    renderApp()

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
    renderApp()

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
    renderApp()

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
    renderApp()

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

  renderApp({ store })
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

describe('Sesión — arranque y cierre', () => {
  it('sin una sesión guardada arranca en el login y no muestra el POS', async () => {
    const { almacen } = almacenDeSesionEnMemoria()

    render(
      <App
        store={crearStoreEnMemoria()}
        sesion={{ almacen, cliente: clienteDeSesionDePrueba(), purgar: async () => {} }}
        sync={syncDePrueba()}
      />,
    )

    expect(await screen.findByRole('heading', { name: /entrá a tu kiosco/i })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Apertura de caja' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Productos' })).toBeNull()
  })

  it('un token que el servidor rechaza vuelve al login y borra la sesión, sin reintentar', async () => {
    const { almacen, estado } = almacenDeSesionEnMemoria(SESION_DE_PRUEBA)
    const cliente = clienteDeSesionDePrueba({
      yo: () => ({ ok: false, error: { motivo: 'no_autenticado', mensaje: 'Sesión vencida.' } }),
    })

    render(
      <App
        store={crearStoreEnMemoria()}
        sesion={{ almacen, cliente, purgar: async () => {} }}
        sync={syncDePrueba()}
      />,
    )

    expect(await screen.findByRole('heading', { name: /entrá a tu kiosco/i })).toBeDefined()
    expect(estado.borrados).toBe(1)
    expect(estado.valor).toBeNull()
    expect(screen.queryByRole('region', { name: 'Apertura de caja' })).toBeNull()
  })

  it('sin red al arrancar abre el POS con la última sesión confirmada', async () => {
    const { almacen } = almacenDeSesionEnMemoria(SESION_DE_PRUEBA)
    const cliente = clienteDeSesionDePrueba({
      yo: () => ({ ok: false, error: { motivo: 'red', mensaje: 'sin red' } }),
    })

    render(
      <App
        store={crearStoreEnMemoria()}
        sesion={{ almacen, cliente, purgar: async () => {} }}
        sync={syncDePrueba()}
      />,
    )

    // La red no decide una venta: el cajero entra con lo último confirmado y cobra igual.
    expect(await screen.findByRole('button', { name: 'Abrir caja' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: /entrá a tu kiosco/i })).toBeNull()
  })

  it('con más de una membresía pide elegir el kiosco y no persiste uno adivinado', async () => {
    const user = userEvent.setup()
    const { almacen, estado } = almacenDeSesionEnMemoria()
    const segundo: Membresia = {
      tenantId: 'kiosco-2',
      slug: 'kiosco-2',
      nombre: 'AlToke · Kiosco dos',
      rol: 'cajero',
    }
    const cliente = clienteDeSesionDePrueba({
      yo: () => ({
        ok: true,
        dato: {
          usuario: USUARIO_DE_PRUEBA,
          membresias: [MEMBRESIA_DE_PRUEBA, segundo],
        },
      }),
    })

    render(
      <App
        store={crearStoreEnMemoria()}
        sesion={{ almacen, cliente, purgar: async () => {} }}
        sync={syncDePrueba()}
      />,
    )

    await user.type(await screen.findByLabelText('Email'), 'duena@kiosco.test')
    await user.type(screen.getByLabelText('Contraseña'), 'secreto123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(
      await screen.findByRole('heading', { name: /en qué kiosco vas a trabajar/i }),
    ).toBeDefined()
    // El login trae un tenant, pero el cliente no lo da por elegido: no hay sesión persistida.
    expect(estado.valor).toBeNull()
    expect(screen.queryByRole('region', { name: 'Apertura de caja' })).toBeNull()

    await user.click(screen.getByRole('button', { name: /Kiosco dos/ }))

    expect(await screen.findByRole('button', { name: 'Abrir caja' })).toBeDefined()
    expect(estado.valor?.tenant.id).toBe('kiosco-2')
    expect(estado.valor?.rol).toBe('cajero')
  })

  it('cerrar sesión purga la base del tenant y vuelve al login', async () => {
    const user = userEvent.setup()
    const { almacen } = almacenDeSesionEnMemoria(SESION_DE_PRUEBA)
    const purgar = vi.fn(async () => {})

    render(
      <App
        store={crearStoreEnMemoria()}
        sesionInicial={SESION_DE_PRUEBA}
        sesion={{ almacen, cliente: clienteDeSesionDePrueba(), purgar }}
        sync={syncDePrueba()}
      />,
    )

    await abrirCaja(user)
    await user.click(screen.getByRole('button', { name: 'Salir' }))

    await waitFor(() => expect(purgar).toHaveBeenCalledWith(SESION_DE_PRUEBA.tenant.id))
    expect(await screen.findByRole('heading', { name: /entrá a tu kiosco/i })).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Apertura de caja' })).toBeNull()
  })
})

describe('POS — gating por rol', () => {
  it('solo_lectura no ve COBRAR, ni el cierre, ni la marca', async () => {
    const user = userEvent.setup()
    renderApp({ rol: 'solo_lectura' })
    await abrirCaja(user)
    await user.click(tejaDeAlfajor())

    expect(screen.queryByRole('button', { name: 'Cobrar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cerrar caja' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Marca' })).toBeNull()
  })

  it('cajero cobra y cierra, pero no administra la marca', async () => {
    const user = userEvent.setup()
    renderApp({ rol: 'cajero' })
    await abrirCaja(user)

    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Marca' })).toBeNull()
  })

  it('owner ve las tres acciones del POS', async () => {
    const user = userEvent.setup()
    renderApp()
    await abrirCaja(user)

    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cerrar caja' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Marca' })).toBeDefined()
  })
})

describe('POS — estado del sync', () => {
  it('muestra pendiente con el conteo cuando el transporte no responde', async () => {
    const store = crearStoreEnMemoria()
    await store.append([eventoDeAjuste(1), eventoDeAjuste(2)])

    const transporteQueNoResponde: TransporteDeSync = {
      async empujar() {
        throw new Error('sin red')
      },
      async traer() {
        throw new Error('sin red')
      },
    }

    renderApp({ store, sync: syncDePrueba({ transporte: transporteQueNoResponde }) })

    const chip = await screen.findByTestId('sync')
    await waitFor(() => {
      expect(chip.textContent?.toLowerCase()).toContain('pendiente')
      expect(chip.textContent).toContain('2')
    })
  })

  it('empuja la venta después de confirmarla, sin esperar la red en el cobro', async () => {
    const user = userEvent.setup()
    const transporte = transporteDePrueba()

    renderApp({ sync: syncDePrueba({ transporte }) })
    await abrirCaja(user)
    await user.click(tejaDeAlfajor())
    await user.click(screen.getByRole('button', { name: 'Cobrar' }))
    await user.click(screen.getByRole('button', { name: 'Cobrar y sacar ticket' }))

    expect(await screen.findByRole('region', { name: 'Venta cobrada' })).toBeDefined()
    await waitFor(() => {
      expect(
        transporte.empujes.some((solicitud) =>
          solicitud.eventos.some((evento) => evento.tipo === 'venta_confirmada'),
        ),
      ).toBe(true)
    }, ESPERA_DE_ESTADO)
  })

  it('muestra la sobreventa proyectada como aviso visible y no bloqueante', async () => {
    const sobreventa: Evento = {
      id: 'evt-servidor-1',
      tenantId: SESION_DE_PRUEBA.tenant.id,
      terminalId: 'servidor',
      secuencia: 1,
      ocurridoEn: '2026-11-23T10:05:00.000Z',
      schemaVersion: 1,
      tipo: 'sobreventa_detectada',
      ventaId: 'venta-1',
      sku: 'alfajor',
      cantidad: 2,
      stockProyectado: -1,
    }
    const transporte = transporteDePrueba({
      traer: () => ({
        ok: true,
        dato: {
          eventos: [sobreventa],
          acuse: { terminalId: 'terminal-1', ultimaSecuencia: 0 },
          hayMas: false,
          siguienteDesde: null,
        },
      }),
    })

    renderApp({ sync: syncDePrueba({ transporte }) })

    const aviso = await screen.findByRole('status', { name: 'Sobreventas detectadas' })
    expect(aviso.textContent).toContain('alfajor')
    expect(aviso.textContent).toContain('-1')

    // El aviso no tapa ni deshabilita la caja: la mercadería salió, el mostrador sigue abierto.
    expect(screen.getByRole('button', { name: 'Abrir caja' })).toBeDefined()
  })
})
