/**
 * Sobreventa contra un Postgres real (docs/specs/0003-api-y-sync.md §Sobreventa, tarea T6).
 *
 * Lo que sólo se puede probar con base:
 *   - dos terminales del mismo tenant venden la última unidad: la segunda venta se acepta igual y
 *     el libro gana **exactamente un** `sobreventa_detectada` con el stock resultante negativo,
 *   - el evento lo escribe el servidor en su terminal reservada (`servidor`) con su propia
 *     secuencia, que no choca con la de ninguna caja,
 *   - reempujar la misma venta (o volver a traer la página) no escribe un segundo evento,
 *   - una tercera venta reporta el stock acumulado y la secuencia del servidor avanza,
 *   - un cliente no puede empujar `sobreventa_detectada` ni usar la terminal `servidor`.
 *
 * Sin `DATABASE_URL` la suite se **omite con un aviso explícito**: omitir no es pasar.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { proyeccionStock, proyectar } from '@altoke/domain'
import type { Evento, StockPorSku } from '@altoke/domain'
import { parsearSyncEmpujarRespuesta, parsearSyncTraerRespuesta } from '@altoke/contracts'
import { crearPool } from './db.ts'
import type { FuenteDeConexiones } from './db.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'
import { crearServidor } from './servidor.ts'

const DIRECTORIO_MIGRACIONES = `${import.meta.dirname}/../migrations`

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}

const urlApp = texto(process.env.DATABASE_URL)
const urlDuenio = texto(process.env.MIGRATIONS_DATABASE_URL) ?? urlApp
const sinBase = urlApp === undefined || urlDuenio === undefined

if (sinBase) {
  process.stderr.write(
    '[apps/api] DATABASE_URL ausente: se OMITEN los tests de sobreventa contra Postgres (5 tests). ' +
      'Para correrlos: pnpm db:up y después ' +
      'DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke ' +
      'MIGRATIONS_DATABASE_URL=postgres://altoke:altoke@localhost:5435/altoke pnpm test.\n',
  )
}

type Cuerpo = Record<string, unknown>

type CuentaRegistrada = {
  readonly token: string
  readonly tenant: { readonly id: string; readonly slug: string }
}

/** Un evento válido de cliente; cada caso pone el cuerpo que quiere empujar. */
function evento(tenantId: string, terminalId: string, secuencia: number, extra: Cuerpo): Cuerpo {
  return {
    id: `evt-${secuencia}-${randomUUID()}`,
    tenantId,
    terminalId,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    ...extra,
  }
}

function ajuste(tenantId: string, terminalId: string, secuencia: number, delta: number): Cuerpo {
  return evento(tenantId, terminalId, secuencia, {
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta,
    causa: 'inicial',
  })
}

/** Los eventos de una venta de una unidad del SKU: lo que la caja escribe al cobrar. */
function venta(
  tenantId: string,
  terminalId: string,
  ventaId: string,
  desdeSecuencia: number,
): Cuerpo[] {
  return [
    evento(tenantId, terminalId, desdeSecuencia, {
      tipo: 'venta_iniciada',
      ventaId,
      turnoId: `turno-${terminalId}`,
    }),
    evento(tenantId, terminalId, desdeSecuencia + 1, {
      tipo: 'item_agregado',
      ventaId,
      sku: 'alfajor',
      cantidad: 1,
      precioUnitarioCentavos: 120_000,
    }),
    evento(tenantId, terminalId, desdeSecuencia + 2, {
      tipo: 'venta_confirmada',
      ventaId,
      totalCentavos: 120_000,
    }),
  ]
}

describe.skipIf(sinBase)('sobreventa contra Postgres', () => {
  let duenio: FuenteDeConexiones
  let pool: FuenteDeConexiones
  let app: FastifyInstance

  const sufijo = randomUUID().slice(0, 8)
  const email = (nombre: string): string => `sobreventa-test-${sufijo}-${nombre}@kiosco.com`
  const slug = (nombre: string): string => `sv-${sufijo}-${nombre}`

  beforeAll(async () => {
    duenio = crearPool(urlDuenio as string)
    await aplicarMigraciones(duenio, leerMigraciones(DIRECTORIO_MIGRACIONES))
    pool = crearPool(urlApp as string)
    app = crearServidor({ pool })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
    await duenio.query('DELETE FROM usuarios WHERE email LIKE $1', [`sobreventa-test-${sufijo}-%`])
    await duenio.query('DELETE FROM tenants WHERE slug LIKE $1', [`sobreventa-test-${sufijo}-%`])
    await duenio.end()
  })

  async function registrar(nombre: string): Promise<CuentaRegistrada> {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: {
        email: email(nombre),
        password: 'contraseña-de-prueba',
        nombre,
        tenant: { nombre: `Kiosco ${nombre}`, slug: slug(nombre) },
      },
    })

    expect(respuesta.statusCode, respuesta.body).toBe(201)
    return respuesta.json() as CuentaRegistrada
  }

  function bearer(token: string) {
    return { authorization: `Bearer ${token}` }
  }

  async function empujar(
    token: string,
    terminalId: string,
    eventos: readonly Cuerpo[],
  ): Promise<Cuerpo> {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/sync/eventos',
      headers: bearer(token),
      payload: { terminalId, eventos },
    })

    expect(respuesta.statusCode, respuesta.body).toBe(200)
    const cuerpo = respuesta.json() as Cuerpo
    expect(parsearSyncEmpujarRespuesta(cuerpo).ok, respuesta.body).toBe(true)
    return cuerpo
  }

  async function traer(token: string, terminalId: string): Promise<Cuerpo> {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/sync/eventos?terminalId=${encodeURIComponent(terminalId)}`,
      headers: bearer(token),
    })

    expect(respuesta.statusCode, respuesta.body).toBe(200)
    const cuerpo = respuesta.json() as Cuerpo
    expect(parsearSyncTraerRespuesta(cuerpo).ok, respuesta.body).toBe(true)
    return cuerpo
  }

  /** Como dueño: RLS no lo alcanza y la prueba mira lo que de verdad quedó guardado. */
  async function filasDe(tenantId: string, terminalId: string): Promise<readonly Cuerpo[]> {
    const resultado = await duenio.query(
      `SELECT id, terminal_id, secuencia::int AS secuencia, cuerpo FROM eventos
       WHERE tenant_id = $1 AND terminal_id = $2 ORDER BY secuencia`,
      [tenantId, terminalId],
    )
    return resultado.rows as unknown as readonly Cuerpo[]
  }

  async function todasLasFilas(tenantId: string): Promise<readonly Cuerpo[]> {
    const resultado = await duenio.query(
      `SELECT cuerpo FROM eventos WHERE tenant_id = $1 ORDER BY recibido_en, id`,
      [tenantId],
    )
    return resultado.rows as unknown as readonly Cuerpo[]
  }

  /** El stock tal como lo diría el dominio sobre el libro completo del tenant. */
  function stockDelLibro(filas: readonly Cuerpo[]): StockPorSku {
    return proyectar(
      filas.map((fila) => fila['cuerpo'] as Evento),
      proyeccionStock(),
    )
  }

  function cuerpos(filas: readonly Cuerpo[]): Cuerpo[] {
    return filas.map((fila) => fila['cuerpo'] as Cuerpo)
  }

  it('la segunda venta de la última unidad deja stock negativo y un solo sobreventa_detectada', async () => {
    const cuenta = await registrar('primera-sobreventa')
    const cajaA = `caja-${sufijo}-a1`
    const cajaB = `caja-${sufijo}-b1`
    const ventaA = `venta-${sufijo}-a1`
    const ventaB = `venta-${sufijo}-b1`

    // La terminal A carga una unidad y la vende: el stock queda en cero, no hay sobreventa.
    await empujar(cuenta.token, cajaA, [ajuste(cuenta.tenant.id, cajaA, 1, 1)])
    const primera = await empujar(cuenta.token, cajaA, venta(cuenta.tenant.id, cajaA, ventaA, 2))
    expect(primera['aceptados']).toHaveLength(3)
    expect(await filasDe(cuenta.tenant.id, 'servidor')).toHaveLength(0)

    // La terminal B vende la misma última unidad: la venta vale y el servidor lo cuenta.
    const segunda = await empujar(cuenta.token, cajaB, venta(cuenta.tenant.id, cajaB, ventaB, 1))
    expect(segunda['aceptados']).toHaveLength(3)

    const delServidor = await filasDe(cuenta.tenant.id, 'servidor')
    expect(delServidor, 'exactamente un evento para esa venta').toHaveLength(1)
    expect(delServidor[0]?.['secuencia'], 'la secuencia del servidor arranca en 1').toBe(1)
    expect(delServidor[0]?.['cuerpo']).toStrictEqual({
      id: expect.any(String),
      tenantId: cuenta.tenant.id,
      terminalId: 'servidor',
      secuencia: 1,
      ocurridoEn: expect.any(String),
      schemaVersion: 1,
      tipo: 'sobreventa_detectada',
      ventaId: ventaB,
      sku: 'alfajor',
      cantidad: 1,
      stockProyectado: -1,
    })

    // La terminal real B conservó sus propias secuencias 1..3: la del servidor no choca con ellas.
    expect((await filasDe(cuenta.tenant.id, cajaB)).map((fila) => fila['secuencia'])).toEqual([
      1, 2, 3,
    ])

    // El stock proyectado del libro entero es negativo, y el evento reporta ese mismo número.
    const libro = await todasLasFilas(cuenta.tenant.id)
    expect(stockDelLibro(libro)).toEqual({ alfajor: -1 })
    expect(cuerpos(delServidor)[0]?.['stockProyectado']).toBe(-1)

    // Y el próximo GET de cualquier terminal trae la alerta: es lo que el POS muestra.
    const traida = await traer(cuenta.token, `caja-${sufijo}-a1-lectora`)
    const traidos = traida['eventos'] as readonly Cuerpo[]
    expect(traidos.map((evento) => evento['tipo'])).toContain('sobreventa_detectada')
    expect(traidos.find((evento) => evento['tipo'] === 'sobreventa_detectada')).toMatchObject({
      terminalId: 'servidor',
      ventaId: ventaB,
      stockProyectado: -1,
    })
  })

  it('reempujar la misma venta no produce un segundo sobreventa_detectada', async () => {
    const cuenta = await registrar('reintento')
    const cajaA = `caja-${sufijo}-a2`
    const cajaB = `caja-${sufijo}-b2`
    const ventaA = `venta-${sufijo}-a2`
    const ventaB = `venta-${sufijo}-b2`

    await empujar(cuenta.token, cajaA, [ajuste(cuenta.tenant.id, cajaA, 1, 1)])
    await empujar(cuenta.token, cajaA, venta(cuenta.tenant.id, cajaA, ventaA, 2))
    const loteB = venta(cuenta.tenant.id, cajaB, ventaB, 1)
    await empujar(cuenta.token, cajaB, loteB)
    expect(await filasDe(cuenta.tenant.id, 'servidor')).toHaveLength(1)

    // El mismo lote otra vez: un reintento tras una respuesta perdida.
    const reintento = await empujar(cuenta.token, cajaB, loteB)
    expect(reintento['aceptados']).toEqual([])
    expect(reintento['duplicados']).toHaveLength(3)
    expect(await filasDe(cuenta.tenant.id, 'servidor')).toHaveLength(1)

    // Y traer la página dos veces tampoco la duplica: la detección no corre al leer.
    const lectora = `caja-${sufijo}-b2-lectora`
    const una = await traer(cuenta.token, lectora)
    const dos = await traer(cuenta.token, lectora)
    expect(dos['eventos']).toStrictEqual(una['eventos'])
    expect(await filasDe(cuenta.tenant.id, 'servidor')).toHaveLength(1)
  })

  it('una tercera venta reporta el stock acumulado y la secuencia del servidor avanza', async () => {
    const cuenta = await registrar('acumulado')
    const [cajaA, cajaB, cajaC] = [
      `caja-${sufijo}-a3`,
      `caja-${sufijo}-b3`,
      `caja-${sufijo}-c3`,
    ] as const
    const [ventaA, ventaB, ventaC] = [
      `venta-${sufijo}-a3`,
      `venta-${sufijo}-b3`,
      `venta-${sufijo}-c3`,
    ] as const

    await empujar(cuenta.token, cajaA, [ajuste(cuenta.tenant.id, cajaA, 1, 1)])
    await empujar(cuenta.token, cajaA, venta(cuenta.tenant.id, cajaA, ventaA, 2))
    await empujar(cuenta.token, cajaB, venta(cuenta.tenant.id, cajaB, ventaB, 1))
    await empujar(cuenta.token, cajaC, venta(cuenta.tenant.id, cajaC, ventaC, 1))

    const delServidor = cuerpos(await filasDe(cuenta.tenant.id, 'servidor'))
    expect(delServidor.map((cuerpo) => [cuerpo['ventaId'], cuerpo['stockProyectado']])).toEqual([
      [ventaB, -1],
      [ventaC, -2],
    ])
    expect(delServidor.map((cuerpo) => cuerpo['secuencia'])).toEqual([1, 2])
    expect(stockDelLibro(await todasLasFilas(cuenta.tenant.id))).toEqual({ alfajor: -2 })
  })

  it('un cliente no puede empujar sobreventa_detectada: se rechaza con el motivo', async () => {
    const cuenta = await registrar('cliente-no-puede')
    const terminal = `caja-${sufijo}-4`
    const falsa = evento(cuenta.tenant.id, terminal, 1, {
      tipo: 'sobreventa_detectada',
      ventaId: `venta-${sufijo}-falsa`,
      sku: 'alfajor',
      cantidad: 1,
      stockProyectado: -1,
    })

    const respuesta = await empujar(cuenta.token, terminal, [falsa])

    expect(respuesta['aceptados']).toEqual([])
    expect(respuesta['duplicados']).toEqual([])
    expect(respuesta['conflictos']).toEqual([])
    expect(respuesta['rechazados']).toHaveLength(1)
    const rechazo = (respuesta['rechazados'] as readonly Cuerpo[])[0]
    expect(rechazo?.['id']).toBe(falsa['id'])
    expect(String(rechazo?.['motivo'])).toContain('sobreventa_detectada')

    // Nada se escribió, ni en la terminal del cliente ni en la del servidor.
    expect(await filasDe(cuenta.tenant.id, terminal)).toHaveLength(0)
    expect(await filasDe(cuenta.tenant.id, 'servidor')).toHaveLength(0)
  })

  it('la terminal `servidor` está reservada: no se empuja ni se consulta con ella', async () => {
    const cuenta = await registrar('reservada')

    const empuje = await app.inject({
      method: 'POST',
      url: '/sync/eventos',
      headers: bearer(cuenta.token),
      payload: {
        terminalId: 'servidor',
        eventos: [ajuste(cuenta.tenant.id, 'servidor', 1, 1)],
      },
    })
    expect(empuje.statusCode).toBe(400)
    expect(empuje.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: expect.stringContaining('servidor'),
        detalle: { campo: 'terminalId' },
      },
    })

    const traida = await app.inject({
      method: 'GET',
      url: '/sync/eventos?terminalId=servidor',
      headers: bearer(cuenta.token),
    })
    expect(traida.statusCode).toBe(400)
    expect(traida.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: expect.stringContaining('servidor'),
        detalle: { campo: 'terminalId' },
      },
    })
  })
})
