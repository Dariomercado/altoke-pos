/**
 * El adaptador `fetch` del puerto de sync (docs/specs/0003-api-y-sync.md §Sync, §Errores).
 *
 * Lo que se prueba:
 *   - el token viaja en `Authorization: Bearer` y el tenant en `X-Tenant`,
 *   - cada respuesta se valida con los parseos del contrato: un cuerpo con forma rara no llega al
 *     llamador como si fuera un evento,
 *   - `validacion`, `sin_permiso` y `no_autenticado` vuelven como resultados tipados,
 *   - una caída de red o un 500 vuelven como `red`, nunca como excepción,
 *   - sin token no se llama a la red.
 */

import { describe, expect, it } from 'vitest'
import { crearTransporteFetch } from './transporte.ts'
import { eventoDePrueba } from './dobles.ts'

const BASE = 'https://api.altoke.app'
const TENANT = 'tenant-1'
const TERMINAL = 'term-1'

interface Llamada {
  readonly url: string
  readonly init: RequestInit
}

function transportar(respuestas: readonly Response[], opciones: {
  readonly token?: string | null
  readonly tenantId?: string
} = {}): { transporte: ReturnType<typeof crearTransporteFetch>; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  const cola = [...respuestas]

  const fetchFalso: typeof fetch = async (entrada, init) => {
    llamadas.push({ url: String(entrada), init: init ?? {} })
    const respuesta = cola.shift()
    if (respuesta === undefined) throw new Error('el test no guionó más respuestas')
    return respuesta
  }

  const transporte = crearTransporteFetch({
    baseUrl: BASE,
    token: () => (opciones.token === undefined ? 'token-1' : opciones.token),
    tenantId: opciones.tenantId,
    fetch: fetchFalso,
  })

  return { transporte, llamadas }
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })
}

function acuse(ultimaSecuencia: number): { readonly terminalId: string; readonly ultimaSecuencia: number } {
  return { terminalId: TERMINAL, ultimaSecuencia }
}

describe('empujar', () => {
  it('manda el lote con Bearer y X-Tenant y devuelve la respuesta validada', async () => {
    const evento = eventoDePrueba(1)
    const { transporte, llamadas } = transportar(
      [
        json({
          aceptados: [{ id: evento.id, secuencia: 1 }],
          duplicados: [],
          conflictos: [],
          rechazados: [],
          acuse: acuse(1),
          huecos: [],
        }),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({ terminalId: TERMINAL, eventos: [evento] })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.acuse.ultimaSecuencia).toBe(1)
    expect(resultado.dato.huecos).toEqual([])
    expect(resultado.dato.aceptados).toEqual([{ id: evento.id, secuencia: 1 }])

    const [llamada] = llamadas
    expect(llamada?.url).toBe(`${BASE}/sync/eventos`)
    expect(llamada?.init.method).toBe('POST')
    const cabeceras = new Headers(llamada?.init.headers)
    expect(cabeceras.get('authorization')).toBe('Bearer token-1')
    expect(cabeceras.get('x-tenant')).toBe(TENANT)
    expect(cabeceras.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(llamada?.init.body))).toEqual({
      terminalId: TERMINAL,
      eventos: [evento],
    })
  })

  it('respeta los huecos que el servidor reporta', async () => {
    const { transporte } = transportar(
      [
        json({
          aceptados: [],
          duplicados: [],
          conflictos: [],
          rechazados: [],
          acuse: acuse(1),
          huecos: [2, 4],
        }),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.huecos).toEqual([2, 4])
  })

  it('un servidor que todavía no manda huecos no rompe: se leen como lista vacía', async () => {
    const { transporte } = transportar(
      [
        json({
          aceptados: [],
          duplicados: [],
          conflictos: [],
          rechazados: [],
          acuse: acuse(0),
        }),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.huecos).toEqual([])
  })

  it('unos huecos con forma inválida no se creen', async () => {
    const { transporte } = transportar(
      [
        json({
          aceptados: [],
          duplicados: [],
          conflictos: [],
          rechazados: [],
          acuse: acuse(1),
          huecos: ['2'],
        }),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado).toEqual({
      ok: false,
      error: {
        motivo: 'respuesta_invalida',
        mensaje: expect.stringContaining('huecos'),
      },
    })
  })

  it('una respuesta que no cumple el contrato es respuesta_invalida, no un evento raro', async () => {
    const { transporte } = transportar(
      [json({ aceptados: [], duplicados: [], conflictos: [], rechazados: [] })],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('respuesta_invalida')
  })
})

describe('traer', () => {
  it('pide la página con terminalId y desde, y devuelve eventos validados', async () => {
    const traido = eventoDePrueba(1, {}, 'term-2')
    const { transporte, llamadas } = transportar(
      [
        json({
          eventos: [traido],
          acuse: acuse(4),
          hayMas: true,
          siguienteDesde: '2026-11-23T03:00:00.000Z',
        }),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.traer({
      terminalId: TERMINAL,
      desde: '2026-11-23T02:00:00.000Z',
    })

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.eventos).toEqual([traido])
    expect(resultado.dato.hayMas).toBe(true)
    expect(resultado.dato.siguienteDesde).toBe('2026-11-23T03:00:00.000Z')

    const [llamada] = llamadas
    const url = new URL(String(llamada?.url))
    expect(url.origin + url.pathname).toBe(`${BASE}/sync/eventos`)
    expect(url.searchParams.get('terminalId')).toBe(TERMINAL)
    expect(url.searchParams.get('desde')).toBe('2026-11-23T02:00:00.000Z')
    expect(llamada?.init.method).toBe('GET')
  })

  it('no se cree una respuesta con hayMas "true" en texto', async () => {
    const { transporte } = transportar(
      [json({ eventos: [], acuse: acuse(0), hayMas: 'true', siguienteDesde: null })],
      { tenantId: TENANT },
    )

    const resultado = await transporte.traer({
      terminalId: TERMINAL,
      desde: '1970-01-01T00:00:00.000Z',
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('respuesta_invalida')
  })
})

describe('errores del servidor', () => {
  it('un 400 vuelve como validacion con el campo que falló', async () => {
    const { transporte } = transportar(
      [
        json(
          {
            error: {
              code: 'validacion',
              mensaje: 'El evento no es válido.',
              detalle: { campo: 'eventos.0.tipo' },
            },
          },
          400,
        ),
      ],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado).toEqual({
      ok: false,
      error: { motivo: 'validacion', mensaje: 'El evento no es válido.', campo: 'eventos.0.tipo' },
    })
  })

  it('un 403 es sin_permiso y un 401 es no_autenticado', async () => {
    const sinPermiso = transportar(
      [json({ error: { code: 'sin_permiso', mensaje: 'No podés empujar.' } }, 403)],
      { tenantId: TENANT },
    )
    const sinSesion = transportar(
      [json({ error: { code: 'no_autenticado', mensaje: 'Iniciá sesión.' } }, 401)],
      { tenantId: TENANT },
    )

    await expect(
      sinPermiso.transporte.empujar({ terminalId: TERMINAL, eventos: [eventoDePrueba(1)] }),
    ).resolves.toEqual({
      ok: false,
      error: { motivo: 'sin_permiso', mensaje: 'No podés empujar.' },
    })
    await expect(
      sinSesion.transporte.empujar({ terminalId: TERMINAL, eventos: [eventoDePrueba(1)] }),
    ).resolves.toEqual({
      ok: false,
      error: { motivo: 'no_autenticado', mensaje: 'Iniciá sesión.' },
    })
  })

  it('un 500 es red: el próximo intento puede funcionar', async () => {
    const { transporte } = transportar(
      [json({ error: { code: 'error_interno', mensaje: 'Error interno.' } }, 500)],
      { tenantId: TENANT },
    )

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('red')
  })

  it('una caída de red es red y no una excepción', async () => {
    const transporte = crearTransporteFetch({
      baseUrl: BASE,
      token: () => 'token-1',
      tenantId: TENANT,
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('red')
  })

  it('sin token no se llama a la red: es no_autenticado, no un 401 tardío', async () => {
    const { transporte, llamadas } = transportar([], { token: null, tenantId: TENANT })

    const resultado = await transporte.empujar({
      terminalId: TERMINAL,
      eventos: [eventoDePrueba(1)],
    })

    expect(resultado).toEqual({
      ok: false,
      error: { motivo: 'no_autenticado', mensaje: expect.any(String) },
    })
    expect(llamadas).toHaveLength(0)
  })
})
