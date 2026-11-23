import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { crearClienteDeSesion } from './cliente.ts'
import { SESION_DE_PRUEBA } from './dobles.ts'

const BASE = 'https://api.test'

type BuscadorFalso = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })
}

function respuestaSesion(): unknown {
  return {
    token: SESION_DE_PRUEBA.token,
    expiraEn: '2026-11-23T22:00:00.000Z',
    usuario: SESION_DE_PRUEBA.usuario,
    tenant: SESION_DE_PRUEBA.tenant,
    rol: SESION_DE_PRUEBA.rol,
  }
}

/** Un `fetch` de mentira con las llamadas a la vista; usa los argumentos reales del adaptador. */
function fetchFalso(
  responder: (url: string, init?: RequestInit) => Response | Promise<Response>,
): {
  readonly buscar: BuscadorFalso
  readonly fetch: typeof fetch
} {
  const buscar: BuscadorFalso = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    return responder(url, init)
  })

  return { buscar, fetch: buscar as unknown as typeof fetch }
}

describe('cliente de sesión', () => {
  it('inicia sesión contra /auth/sesion y devuelve la sesión validada', async () => {
    const { buscar, fetch } = fetchFalso(() => json(respuestaSesion()))
    const cliente = crearClienteDeSesion({ baseUrl: BASE, fetch })

    const resultado = await cliente.iniciarSesion('duena@kiosco.test', 'secreto123')

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.token).toBe(SESION_DE_PRUEBA.token)
    expect(resultado.dato.rol).toBe('owner')

    const [url, init] = buscar.mock.calls[0] ?? []
    expect(url).toBe(`${BASE}/auth/sesion`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'duena@kiosco.test',
      password: 'secreto123',
    })
  })

  it('traduce el 401 a no_autenticado con el mensaje del servidor', async () => {
    const { fetch } = fetchFalso(() =>
      json({ error: { code: 'no_autenticado', mensaje: 'Email o contraseña incorrectos.' } }, 401),
    )
    const cliente = crearClienteDeSesion({ baseUrl: BASE, fetch })

    const resultado = await cliente.iniciarSesion('duena@kiosco.test', 'mal')

    expect(resultado).toEqual({
      ok: false,
      error: { motivo: 'no_autenticado', mensaje: 'Email o contraseña incorrectos.' },
    })
  })

  it('traduce un 400 a validacion con el campo que falló', async () => {
    const { fetch } = fetchFalso(() =>
      json(
        {
          error: {
            code: 'validacion',
            mensaje: 'El slug tiene que tener entre 2 y 40 caracteres: minúsculas, números y guiones.',
            detalle: { campo: 'tenant.slug' },
          },
        },
        400,
      ),
    )
    const cliente = crearClienteDeSesion({ baseUrl: BASE, fetch })

    const resultado = await cliente.registro({
      nombre: 'Dueña',
      email: 'duena@kiosco.test',
      password: 'secreto123',
      tenant: { nombre: 'Kiosco', slug: 'k' },
    })

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('validacion')
    expect(resultado.error.motivo === 'validacion' ? resultado.error.campo : null).toBe('tenant.slug')
  })

  it('una caída de red es un error con motivo, no una excepción', async () => {
    const { fetch } = fetchFalso(() => {
      throw new Error('ECONNREFUSED')
    })
    const cliente = crearClienteDeSesion({ baseUrl: BASE, fetch })

    const resultado = await cliente.yo(SESION_DE_PRUEBA.token, SESION_DE_PRUEBA.tenant.slug)

    expect(resultado.ok).toBe(false)
    if (resultado.ok) return
    expect(resultado.error.motivo).toBe('red')
  })

  it('manda el token en Bearer y el tenant en X-Tenant para /auth/yo', async () => {
    const { buscar, fetch } = fetchFalso(() =>
      json({
        usuario: SESION_DE_PRUEBA.usuario,
        membresias: [
          {
            tenantId: SESION_DE_PRUEBA.tenant.id,
            slug: SESION_DE_PRUEBA.tenant.slug,
            nombre: SESION_DE_PRUEBA.tenant.nombre,
            rol: SESION_DE_PRUEBA.rol,
          },
        ],
      }),
    )
    const cliente = crearClienteDeSesion({ baseUrl: BASE, fetch })

    const resultado = await cliente.yo(SESION_DE_PRUEBA.token, SESION_DE_PRUEBA.tenant.slug)

    expect(resultado.ok).toBe(true)
    if (!resultado.ok) return
    expect(resultado.dato.membresias).toHaveLength(1)

    const [, init] = buscar.mock.calls[0] ?? []
    const cabeceras = init?.headers as Record<string, string>
    expect(cabeceras.authorization).toBe(`Bearer ${SESION_DE_PRUEBA.token}`)
    expect(cabeceras['x-tenant']).toBe(SESION_DE_PRUEBA.tenant.slug)
  })
})
