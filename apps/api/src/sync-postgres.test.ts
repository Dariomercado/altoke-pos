/**
 * Sync entre terminales contra un Postgres real (docs/specs/0003-api-y-sync.md §Sync, tarea T5).
 *
 * Lo que sólo se puede probar con base:
 *   - la idempotencia por `(tenant, terminal, secuencia)` la arbitra la base: el mismo lote dos veces
 *     es `aceptados` y después `duplicados`, sin filas nuevas,
 *   - el mismo `(terminal, secuencia)` con otro cuerpo es `conflicto` y **no** reescribe la fila,
 *   - un `id` reusado en otra secuencia se rechaza en vez de pisar,
 *   - un evento inválido no aborta el lote: sus hermanos se aceptan,
 *   - el acuse es el máximo **contiguo**, no el máximo, y los huecos se reportan,
 *   - la traída excluye la terminal propia, ordena por `(recibido_en, id)` y pagina con `hayMas` y
 *     `siguienteDesde` sin perder los eventos empatados en la frontera de la página,
 *   - la terminal del cuerpo no es de fiar: el tenant sale de la sesión,
 *   - `solo_lectura` empuja `sin_permiso` y trae sin problema, y un token del tenant A no ve al B.
 *
 * Sin `DATABASE_URL` la suite se **omite con un aviso explícito**: omitir no es pasar.
 */

import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION_SOPORTADA,
  parsearSyncEmpujarRespuesta,
  parsearSyncTraerRespuesta,
} from '@altoke/contracts'
import type { CadenaDeMigraciones } from '@altoke/domain'
import { crearPool } from './db.ts'
import type { FuenteDeConexiones } from './db.ts'
import { traerEventos } from './eventos.ts'
import { aplicarMigraciones, leerMigraciones } from './migraciones.ts'
import { hashPassword } from './password.ts'
import { crearServidor } from './servidor.ts'
import { enTransaccionDeTenant } from './transaccion.ts'

const DIRECTORIO_MIGRACIONES = `${import.meta.dirname}/../migrations`
const PASSWORD = 'contraseña-de-prueba'

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}

const urlApp = texto(process.env.DATABASE_URL)
const urlDuenio = texto(process.env.MIGRATIONS_DATABASE_URL) ?? urlApp
const sinBase = urlApp === undefined || urlDuenio === undefined

if (sinBase) {
  process.stderr.write(
    '[apps/api] DATABASE_URL ausente: se OMITEN los tests de sync contra Postgres (18 tests). ' +
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

/** Un `ajuste_stock` válido: el tipo más chico del libro y el que menos ruido trae a los asserts. */
function evento(
  tenantId: string,
  terminalId: string,
  secuencia: number,
  extra: Cuerpo = {},
): Cuerpo {
  return {
    id: `evt-${secuencia}-${randomUUID()}`,
    tenantId,
    terminalId,
    secuencia,
    ocurridoEn: '2026-11-22T10:00:00.000Z',
    schemaVersion: 1,
    tipo: 'ajuste_stock',
    sku: 'alfajor',
    delta: 1,
    causa: 'compra',
    ...extra,
  }
}

function deSecuencias(
  tenantId: string,
  terminalId: string,
  secuencias: readonly number[],
): Cuerpo[] {
  return secuencias.map((secuencia) => evento(tenantId, terminalId, secuencia))
}

function secuenciasDe(lista: unknown): number[] {
  return (lista as readonly { readonly secuencia: number }[]).map((item) => item.secuencia)
}

describe.skipIf(sinBase)('sync contra Postgres', () => {
  let duenio: FuenteDeConexiones
  let pool: FuenteDeConexiones
  let app: FastifyInstance

  // Un prefijo por corrida: la limpieza no toca datos de nadie más.
  const sufijo = randomUUID().slice(0, 8)
  const email = (nombre: string): string => `sync-test-${sufijo}-${nombre}@kiosco.com`
  const slug = (nombre: string): string => `sync-test-${sufijo}-${nombre}`

  beforeAll(async () => {
    duenio = crearPool(urlDuenio as string)
    await aplicarMigraciones(duenio, leerMigraciones(DIRECTORIO_MIGRACIONES))
    pool = crearPool(urlApp as string)
    app = crearServidor({ pool })
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
    await duenio.query('DELETE FROM usuarios WHERE email LIKE $1', [`sync-test-${sufijo}-%`])
    await duenio.query('DELETE FROM tenants WHERE slug LIKE $1', [`sync-test-${sufijo}-%`])
    await duenio.end()
  })

  async function registrar(nombre: string): Promise<CuentaRegistrada> {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/registro',
      payload: {
        email: email(nombre),
        password: PASSWORD,
        nombre,
        tenant: { nombre: `Kiosco ${nombre}`, slug: slug(nombre) },
      },
    })

    expect(respuesta.statusCode, respuesta.body).toBe(201)
    return respuesta.json() as CuentaRegistrada
  }

  /** Miembro del tenant con el rol pedido, creado como dueño: `membresias` no lo alcanza RLS. */
  async function crearMiembro(
    tenantId: string,
    nombre: string,
    rol: 'owner' | 'admin' | 'cajero' | 'solo_lectura',
  ): Promise<string> {
    const usuarioId = randomUUID()
    await duenio.query(
      `INSERT INTO usuarios (id, email, nombre, password_hash) VALUES ($1, $2, $3, $4)`,
      [usuarioId, email(nombre), nombre, await hashPassword(PASSWORD)],
    )
    await duenio.query(
      `INSERT INTO membresias (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)`,
      [usuarioId, tenantId, rol],
    )

    const login = await app.inject({
      method: 'POST',
      url: '/auth/sesion',
      payload: { email: email(nombre), password: PASSWORD },
    })
    expect(login.statusCode, login.body).toBe(200)
    return login.json().token as string
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
    // El contrato de T4 acepta la respuesta del servidor: si no, hay un bug del lado del servidor.
    expect(parsearSyncEmpujarRespuesta(cuerpo).ok, respuesta.body).toBe(true)
    return cuerpo
  }

  async function traer(
    token: string,
    terminalId: string,
    desde?: string,
  ): Promise<Cuerpo> {
    const consulta = new URLSearchParams({ terminalId })
    if (desde !== undefined) consulta.set('desde', desde)

    const respuesta = await app.inject({
      method: 'GET',
      url: `/sync/eventos?${consulta.toString()}`,
      headers: bearer(token),
    })

    expect(respuesta.statusCode, respuesta.body).toBe(200)
    const cuerpo = respuesta.json() as Cuerpo
    expect(parsearSyncTraerRespuesta(cuerpo).ok, respuesta.body).toBe(true)
    return cuerpo
  }

  /** El acuse que quedó en la tabla: es lo que la terminal lee para dejar de reenviar. */
  async function acuseGuardado(tenantId: string, terminalId: string): Promise<unknown> {
    const resultado = await duenio.query(
      `SELECT ultima_secuencia::int AS ultima FROM acuses WHERE tenant_id = $1 AND terminal_id = $2`,
      [tenantId, terminalId],
    )
    return resultado.rows[0]?.['ultima']
  }

  /** Como dueño: RLS no lo alcanza y la prueba mira lo que de verdad quedó guardado. */
  async function filasDe(tenantId: string, terminalId?: string): Promise<readonly Cuerpo[]> {
    const resultado =
      terminalId === undefined
        ? await duenio.query(
            `SELECT id, terminal_id, secuencia::int AS secuencia, cuerpo FROM eventos
             WHERE tenant_id = $1 ORDER BY secuencia`,
            [tenantId],
          )
        : await duenio.query(
            `SELECT id, terminal_id, secuencia::int AS secuencia, cuerpo FROM eventos
             WHERE tenant_id = $1 AND terminal_id = $2 ORDER BY secuencia`,
            [tenantId, terminalId],
          )
    return resultado.rows as unknown as readonly Cuerpo[]
  }

  it('el mismo lote dos veces es aceptados y después duplicados, sin filas nuevas', async () => {
    const cuenta = await registrar('idempotencia')
    const terminal = `caja-${sufijo}-1`
    const lote = deSecuencias(cuenta.tenant.id, terminal, [1, 2, 3])

    const primera = await empujar(cuenta.token, terminal, lote)
    expect(secuenciasDe(primera['aceptados'])).toEqual([1, 2, 3])
    expect(primera['duplicados']).toEqual([])
    expect(primera['conflictos']).toEqual([])
    expect(primera['rechazados']).toEqual([])
    expect(primera['acuse']).toStrictEqual({ terminalId: terminal, ultimaSecuencia: 3 })
    expect(await filasDe(cuenta.tenant.id, terminal)).toHaveLength(3)

    const segunda = await empujar(cuenta.token, terminal, lote)
    expect(segunda['aceptados']).toEqual([])
    expect(secuenciasDe(segunda['duplicados'])).toEqual([1, 2, 3])
    expect(segunda['conflictos']).toEqual([])
    expect(segunda['rechazados']).toEqual([])
    expect(segunda['acuse']).toStrictEqual({ terminalId: terminal, ultimaSecuencia: 3 })
    expect(await filasDe(cuenta.tenant.id, terminal), 'un reintento no duplica nada').toHaveLength(3)
    expect(await acuseGuardado(cuenta.tenant.id, terminal)).toBe(3)
  })

  it('una schemaVersion futura se rechaza al empujar: la cadena no migra hacia atrás', async () => {
    const cuenta = await registrar('futura-push')
    const terminal = `caja-${sufijo}-14`

    const respuesta = await empujar(cuenta.token, terminal, [
      evento(cuenta.tenant.id, terminal, 1),
      evento(cuenta.tenant.id, terminal, 2, { schemaVersion: SCHEMA_VERSION_SOPORTADA + 1 }),
    ])

    expect(secuenciasDe(respuesta['aceptados']), 'el v1 se escribe').toEqual([1])
    expect(respuesta['rechazados']).toHaveLength(1)
    const rechazo = (respuesta['rechazados'] as readonly Cuerpo[])[0]
    expect(String(rechazo?.['motivo'])).toContain('más nueva')
    expect(await filasDe(cuenta.tenant.id, terminal)).toHaveLength(1)
  })

  it('la misma (terminal, secuencia) con otro cuerpo es conflicto y la fila guardada no cambia', async () => {
    const cuenta = await registrar('conflicto')
    const terminal = `caja-${sufijo}-2`
    const original = evento(cuenta.tenant.id, terminal, 1, { sku: 'alfajor', delta: 5 })
    await empujar(cuenta.token, terminal, [original])

    const otroCuerpo = evento(cuenta.tenant.id, terminal, 1, { sku: 'alfajor', delta: -5 })
    const respuesta = await empujar(cuenta.token, terminal, [otroCuerpo])

    expect(respuesta['aceptados']).toEqual([])
    expect(respuesta['duplicados']).toEqual([])
    expect(respuesta['conflictos']).toHaveLength(1)
    const conflicto = (respuesta['conflictos'] as readonly Cuerpo[])[0]
    expect(conflicto?.['secuencia']).toBe(1)
    expect(String(conflicto?.['motivo'])).not.toBe('')

    // El servidor no reescribe: la fila sigue con el primer cuerpo, no con el que llegó después.
    const filas = await filasDe(cuenta.tenant.id, terminal)
    expect(filas).toHaveLength(1)
    expect(filas[0]?.['cuerpo']).toMatchObject({
      id: original['id'],
      delta: 5,
      causa: 'compra',
    })
  })

  it('un id reusado en otra secuencia se rechaza en vez de pisar el evento que ya existe', async () => {
    const cuenta = await registrar('id-reusado')
    const terminal = `caja-${sufijo}-3`
    const primero = evento(cuenta.tenant.id, terminal, 1)
    await empujar(cuenta.token, terminal, [primero])

    const mismoId = evento(cuenta.tenant.id, terminal, 2, { id: primero['id'] })
    const respuesta = await empujar(cuenta.token, terminal, [mismoId])

    expect(respuesta['aceptados']).toEqual([])
    expect(respuesta['duplicados']).toEqual([])
    expect(respuesta['conflictos']).toHaveLength(1)
    expect((respuesta['conflictos'] as readonly Cuerpo[])[0]?.['secuencia']).toBe(2)

    const filas = await filasDe(cuenta.tenant.id, terminal)
    expect(filas, 'no se escribió la secuencia 2 ni se tocó la 1').toHaveLength(1)
    expect(filas[0]?.['secuencia']).toBe(1)
    expect(filas[0]?.['id']).toBe(primero['id'])
  })

  it('un evento inválido es rechazado y sus hermanos se aceptan', async () => {
    const cuenta = await registrar('rechazo')
    const terminal = `caja-${sufijo}-4`

    const respuesta = await empujar(cuenta.token, terminal, [
      evento(cuenta.tenant.id, terminal, 1),
      evento(cuenta.tenant.id, terminal, 2, { cantidad: 0, tipo: 'item_agregado', ventaId: 'v-1' }),
      evento(cuenta.tenant.id, terminal, 3),
    ])

    expect(secuenciasDe(respuesta['aceptados'])).toEqual([1, 3])
    expect(respuesta['rechazados']).toHaveLength(1)
    const rechazo = (respuesta['rechazados'] as readonly Cuerpo[])[0]
    expect(String(rechazo?.['motivo'])).not.toBe('')

    const filas = await filasDe(cuenta.tenant.id, terminal)
    expect(filas.map((fila) => fila['secuencia']), 'el inválido no se escribe').toEqual([1, 3])
    // Y el hueco que deja el rechazo se reporta, no se completa en silencio.
    expect(respuesta['acuse']).toStrictEqual({ terminalId: terminal, ultimaSecuencia: 1 })
    expect(respuesta['huecos']).toEqual([2])
  })

  it('el acuse es el máximo contiguo y los huecos se listan', async () => {
    const cuenta = await registrar('huecos')
    const terminal = `caja-${sufijo}-5`

    const respuesta = await empujar(cuenta.token, terminal, deSecuencias(
      cuenta.tenant.id,
      terminal,
      [1, 2, 4, 6],
    ))

    expect(respuesta['acuse']).toStrictEqual({ terminalId: terminal, ultimaSecuencia: 2 })
    expect(respuesta['huecos']).toEqual([3, 5])
    // Lo guardado también es el contiguo, no el máximo: el 6 no se acusa mientras falte el 3.
    expect(await acuseGuardado(cuenta.tenant.id, terminal)).toBe(2)

    // Un lote que empieza en 1 pero arranca con un hueco deja el acuse en cero, no en el máximo.
    const conHuecoInicial = await empujar(
      cuenta.token,
      `caja-${sufijo}-5b`,
      deSecuencias(cuenta.tenant.id, `caja-${sufijo}-5b`, [2, 3]),
    )
    expect(conHuecoInicial['acuse']).toStrictEqual({
      terminalId: `caja-${sufijo}-5b`,
      ultimaSecuencia: 0,
    })
    expect(conHuecoInicial['huecos']).toEqual([1])
  })

  it('la traída excluye la terminal propia y trae la de otra terminal', async () => {
    const cuenta = await registrar('traida')
    const propia = `caja-${sufijo}-6`
    const otra = `caja-${sufijo}-6b`
    const ajenos = deSecuencias(cuenta.tenant.id, otra, [1, 2])
    await empujar(cuenta.token, propia, deSecuencias(cuenta.tenant.id, propia, [1, 2, 3]))
    await empujar(cuenta.token, otra, ajenos)

    const respuesta = await traer(cuenta.token, propia)

    expect(secuenciasDe(respuesta['eventos'])).toEqual([1, 2])
    expect(
      (respuesta['eventos'] as readonly Cuerpo[]).every((e) => e['terminalId'] === otra),
      'los de la propia terminal ya están en su libro',
    ).toBe(true)
    expect((respuesta['eventos'] as readonly Cuerpo[]).map((e) => e['id'])).toEqual(
      ajenos.map((e) => e['id']),
    )
    expect(respuesta['acuse']).toStrictEqual({ terminalId: propia, ultimaSecuencia: 3 })
    expect(respuesta['hayMas']).toBe(false)
    expect(respuesta['siguienteDesde']).toBeNull()
  })

  it('la traída migra en memoria: el cuerpo sale migrado y la fila guardada no se reescribe', async () => {
    const cuenta = await registrar('migracion-lectura')
    const terminal = `caja-${sufijo}-15`
    const lectora = otraTerminal(terminal)
    await empujar(cuenta.token, terminal, [evento(cuenta.tenant.id, terminal, 1)])

    // Cadena sintética: M2 no tiene ninguna migración real (0003 §schemaVersion), así que la única
    // forma de comprobar que la traída migra de verdad es inyectarle un paso. Vive sólo acá.
    const cadena: CadenaDeMigraciones = {
      hasta: 2,
      pasos: [{ desde: 1, aplicar: (cuerpo) => ({ ...cuerpo, causa: 'compra-migrada' }) }],
    }
    const traerConCadena = async () =>
      enTransaccionDeTenant(pool, cuenta.tenant.id, (conexion) =>
        traerEventos(conexion, {
          tenantId: cuenta.tenant.id,
          terminalId: lectora,
          desde: undefined,
          cadena,
        }),
      )

    const primera = await traerConCadena()
    const segunda = await traerConCadena()

    expect(primera.eventos).toHaveLength(1)
    expect(segunda.eventos, 'leer dos veces da lo mismo').toStrictEqual(primera.eventos)
    const migrado = primera.eventos[0] as unknown as Cuerpo
    expect(migrado['schemaVersion']).toBe(2)
    expect(migrado['causa']).toBe('compra-migrada')

    const fila = (
      await duenio.query(
        `SELECT schema_version, cuerpo FROM eventos WHERE tenant_id = $1 AND terminal_id = $2`,
        [cuenta.tenant.id, terminal],
      )
    ).rows[0]
    expect(fila?.['schema_version'], 'lo guardado sigue en v1').toBe(1)
    expect((fila?.['cuerpo'] as Cuerpo)['causa'], 'y con el cuerpo que escribió la terminal').toBe(
      'compra',
    )
  })

  it('una fila ilegible se saltea y se cuenta: no envenena la traída del tenant', async () => {
    const cuenta = await registrar('futura-lectura')
    const terminal = `caja-${sufijo}-16`
    const lectora = otraTerminal(terminal)
    const futura = SCHEMA_VERSION_SOPORTADA + 1
    const ilegible = evento(cuenta.tenant.id, terminal, 2, { schemaVersion: futura })

    // Un evento válido antes y otro después dejan la fila ilegible en el medio de la página: si la
    // traída entera fallara, el tenant se quedaría sin pull por una fila que nadie puede corregir.
    await empujar(cuenta.token, terminal, [evento(cuenta.tenant.id, terminal, 1)])

    // Como dueño: RLS no lo alcanza y es la única forma de dejar una fila que este código no
    // sabe leer (un servidor más nuevo escribió antes que éste).
    await duenio.query(
      `INSERT INTO eventos (id, tenant_id, terminal_id, secuencia, tipo, ocurrido_en,
                            schema_version, cuerpo, recibido_en)
       VALUES ($1, $2, $3, 2, 'ajuste_stock', '2026-11-22T10:00:00.000Z', $4, $5::jsonb, clock_timestamp())`,
      [ilegible['id'], cuenta.tenant.id, terminal, futura, JSON.stringify(ilegible)],
    )

    await empujar(cuenta.token, terminal, [evento(cuenta.tenant.id, terminal, 3)])

    const respuesta = await traer(cuenta.token, lectora)

    expect(secuenciasDe(respuesta['eventos']), 'la ilegible no viaja, las demás sí').toEqual([1, 3])
    expect(respuesta['ilegibles'], 'y el hecho se cuenta en la respuesta').toBe(1)
    expect(respuesta['hayMas']).toBe(false)
    expect(respuesta['siguienteDesde']).toBeNull()

    const fila = (
      await duenio.query(
        `SELECT schema_version FROM eventos WHERE tenant_id = $1 AND terminal_id = $2 AND secuencia = 2`,
        [cuenta.tenant.id, terminal],
      )
    ).rows[0]
    expect(fila?.['schema_version'], 'la fila ilegible no se toca').toBe(futura)
  })

  it('cada evento del mismo lote tiene su propio recibido_en, en orden creciente', async () => {
    const cuenta = await registrar('recibido-en')
    const terminal = `caja-${sufijo}-7`

    // Un solo pedido: los tres eventos entran en la misma transacción. Con el `now()` de la
    // transacción los tres compartirían timestamp y el cursor `recibido_en > desde` perdería a los
    // empatados al cortar una página.
    await empujar(cuenta.token, terminal, deSecuencias(cuenta.tenant.id, terminal, [1, 2, 3]))

    const resultado = await duenio.query(
      `SELECT recibido_en FROM eventos WHERE tenant_id = $1 AND terminal_id = $2
       ORDER BY recibido_en`,
      [cuenta.tenant.id, terminal],
    )
    const recibidos = resultado.rows.map((fila) => (fila['recibido_en'] as Date).getTime())

    expect(recibidos).toHaveLength(3)
    expect(new Set(recibidos).size, 'los tres timestamps son distintos').toBe(3)
    expect(recibidos[0]).toBeLessThan(recibidos[1] as number)
    expect(recibidos[1]).toBeLessThan(recibidos[2] as number)
  })

  it('250 eventos del mismo lote se paginan en 200 + 50 con hayMas y siguienteDesde', async () => {
    const cuenta = await registrar('paginado')
    const terminal = `caja-${sufijo}-8`
    const secuencias = Array.from({ length: 250 }, (_, indice) => indice + 1)

    await empujar(cuenta.token, terminal, deSecuencias(cuenta.tenant.id, terminal, secuencias))

    const primera = await traer(cuenta.token, otraTerminal(terminal))
    expect(primera['eventos']).toHaveLength(200)
    expect(primera['hayMas']).toBe(true)
    expect(typeof primera['siguienteDesde']).toBe('string')
    expect(secuenciasDe(primera['eventos'])).toEqual(secuencias.slice(0, 200))

    const segunda = await traer(cuenta.token, otraTerminal(terminal), String(primera['siguienteDesde']))
    expect(segunda['eventos']).toHaveLength(50)
    expect(segunda['hayMas']).toBe(false)
    expect(segunda['siguienteDesde']).toBeNull()
    expect(secuenciasDe(segunda['eventos'])).toEqual(secuencias.slice(200))

    // Ni un evento perdido, ni uno repetido entre las dos páginas.
    const ids = [...(primera['eventos'] as readonly Cuerpo[]), ...(segunda['eventos'] as readonly Cuerpo[])]
      .map((e) => e['id'])
    expect(new Set(ids).size).toBe(250)
  })

  it('201 eventos del mismo lote: la frontera de la página no pierde el evento 201', async () => {
    const cuenta = await registrar('frontera')
    const terminal = `caja-${sufijo}-9`
    const secuencias = Array.from({ length: 201 }, (_, indice) => indice + 1)

    // Los 201 van en una sola transacción: si compartieran `recibido_en`, la segunda página pediría
    // `recibido_en > siguienteDesde` y devolvería 0 filas, con el evento 201 perdido para siempre.
    await empujar(cuenta.token, terminal, deSecuencias(cuenta.tenant.id, terminal, secuencias))

    const primera = await traer(cuenta.token, otraTerminal(terminal))
    expect(primera['eventos']).toHaveLength(200)
    expect(primera['hayMas']).toBe(true)

    const segunda = await traer(
      cuenta.token,
      otraTerminal(terminal),
      String(primera['siguienteDesde']),
    )
    expect(secuenciasDe(segunda['eventos'])).toEqual([201])
    expect(segunda['hayMas']).toBe(false)
  })

  it('desde filtra por el reloj del servidor: un evento en el cursor no se repite', async () => {
    const cuenta = await registrar('desde')
    const terminal = `caja-${sufijo}-10`
    const otra = `caja-${sufijo}-10b`
    await empujar(cuenta.token, otra, deSecuencias(cuenta.tenant.id, otra, [1, 2]))

    const completo = await traer(cuenta.token, terminal)
    expect(completo['eventos']).toHaveLength(2)

    // El cursor es el ISO con microsegundos que el servidor devuelve en `siguienteDesde`.
    const primera = await duenio.query(
      `SELECT to_char(recibido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS desde
       FROM eventos WHERE tenant_id = $1 AND terminal_id = $2 ORDER BY recibido_en LIMIT 1`,
      [cuenta.tenant.id, otra],
    )
    const desde = String(primera.rows[0]?.['desde'])
    const despues = await traer(cuenta.token, terminal, desde)

    expect(despues['eventos']).toHaveLength(1)
    expect(secuenciasDe(despues['eventos'])).toEqual([2])
  })

  it('un token del tenant A nunca ve los eventos del tenant B', async () => {
    const a = await registrar('tenant-a')
    const b = await registrar('tenant-b')
    const terminalB = `caja-${sufijo}-11b`
    const secretos = deSecuencias(b.tenant.id, terminalB, [1, 2])
    await empujar(b.token, terminalB, secretos)

    const respuesta = await traer(a.token, `caja-${sufijo}-11a`)
    expect(respuesta['eventos']).toEqual([])

    // Y empujar con el terminalId de la otra terminal no escribe nada en el tenant ajeno.
    await empujar(a.token, `caja-${sufijo}-11a`, [
      evento(a.tenant.id, `caja-${sufijo}-11a`, 1),
    ])
    expect(await filasDe(b.tenant.id, terminalB)).toHaveLength(2)
    expect(await filasDe(a.tenant.id)).toHaveLength(1)
  })

  it('un evento que declara otro tenant o otra terminal no se escribe: la sesión manda', async () => {
    const a = await registrar('tenant-cuerpo-a')
    const b = await registrar('tenant-cuerpo-b')
    const terminal = `caja-${sufijo}-12`

    const respuesta = await empujar(a.token, terminal, [
      evento(b.tenant.id, terminal, 1),
      evento(a.tenant.id, `caja-${sufijo}-12-otra`, 2),
      evento(a.tenant.id, terminal, 3),
    ])

    expect(secuenciasDe(respuesta['aceptados']), 'sólo el que coincide con sesión y sobre').toEqual([
      3,
    ])
    expect(respuesta['rechazados']).toHaveLength(2)
    for (const rechazo of respuesta['rechazados'] as readonly Cuerpo[]) {
      expect(String(rechazo['motivo'])).not.toBe('')
    }
    expect(await filasDe(b.tenant.id), 'nada se escribe en el tenant ajeno').toHaveLength(0)
    expect(await filasDe(a.tenant.id), 'y el tenant de la sesión sólo guarda lo que declaró').toEqual([
      expect.objectContaining({ secuencia: 3, terminal_id: terminal }),
    ])
  })

  it('solo_lectura empuja sin_permiso y trae sin problema; cajero sí empuja', async () => {
    const cuenta = await registrar('roles-sync')
    const terminal = `caja-${sufijo}-13`
    const tokenLectura = await crearMiembro(cuenta.tenant.id, 'sync-lectura', 'solo_lectura')
    const tokenCajero = await crearMiembro(cuenta.tenant.id, 'sync-cajero', 'cajero')
    await empujar(cuenta.token, `caja-${sufijo}-13b`, deSecuencias(cuenta.tenant.id, `caja-${sufijo}-13b`, [1]))

    const empujeLectura = await app.inject({
      method: 'POST',
      url: '/sync/eventos',
      headers: bearer(tokenLectura),
      payload: { terminalId: terminal, eventos: deSecuencias(cuenta.tenant.id, terminal, [1]) },
    })
    expect(empujeLectura.statusCode).toBe(403)
    expect(empujeLectura.json()).toStrictEqual({
      error: { code: 'sin_permiso', mensaje: 'No tenés permiso para esta acción.' },
    })

    const traidaLectura = await traer(tokenLectura, terminal)
    expect(traidaLectura['eventos']).toHaveLength(1)

    const empujeCajero = await empujar(
      tokenCajero,
      terminal,
      deSecuencias(cuenta.tenant.id, terminal, [1]),
    )
    expect(secuenciasDe(empujeCajero['aceptados'])).toEqual([1])
  })

  it('valida el sobre: terminalId de 1 a 64 caracteres, eventos no vacío y desde ISO', async () => {
    const cuenta = await registrar('validacion')
    const casos = [
      { terminalId: '', eventos: [], campo: 'terminalId' },
      { terminalId: 'x'.repeat(65), eventos: [], campo: 'terminalId' },
      { terminalId: 'caja-ok', eventos: [], campo: 'eventos' },
      { terminalId: 'caja-ok', campo: 'eventos' },
      { terminalId: 'x'.repeat(64), eventos: [evento(cuenta.tenant.id, 'x'.repeat(64), 1)], campo: null },
    ] as const

    for (const caso of casos) {
      const cuerpo: Cuerpo = { terminalId: caso.terminalId }
      if ('eventos' in caso) cuerpo['eventos'] = caso.eventos

      const respuesta = await app.inject({
        method: 'POST',
        url: '/sync/eventos',
        headers: bearer(cuenta.token),
        payload: cuerpo,
      })

      if (caso.campo === null) {
        expect(respuesta.statusCode, `64 caracteres es válido: ${respuesta.body}`).toBe(200)
        continue
      }
      expect(respuesta.statusCode, `${JSON.stringify(cuerpo)} → 400`).toBe(400)
      expect(respuesta.json()).toStrictEqual({
        error: {
          code: 'validacion',
          mensaje: expect.stringContaining(String(caso.campo === 'terminalId' ? 'terminalId' : 'eventos')),
          detalle: { campo: caso.campo },
        },
      })
    }

    const desdeInvalido = await app.inject({
      method: 'GET',
      url: '/sync/eventos?terminalId=caja-ok&desde=ayer',
      headers: bearer(cuenta.token),
    })
    expect(desdeInvalido.statusCode).toBe(400)
    expect(desdeInvalido.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: expect.stringContaining('desde'),
        detalle: { campo: 'desde' },
      },
    })

    const sinTerminal = await app.inject({
      method: 'GET',
      url: '/sync/eventos',
      headers: bearer(cuenta.token),
    })
    expect(sinTerminal.statusCode).toBe(400)
    expect(sinTerminal.json()).toStrictEqual({
      error: {
        code: 'validacion',
        mensaje: expect.stringContaining('terminalId'),
        detalle: { campo: 'terminalId' },
      },
    })
  })

  it('exige sesión: sin token el sync es no_autenticado', async () => {
    const empuje = await app.inject({
      method: 'POST',
      url: '/sync/eventos',
      payload: { terminalId: 'caja', eventos: [] },
    })
    expect(empuje.statusCode).toBe(401)
    expect(empuje.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })

    const traida = await app.inject({ method: 'GET', url: '/sync/eventos?terminalId=caja' })
    expect(traida.statusCode).toBe(401)
  })

  // Vive acá porque es el único test de este cambio con una base real: el bug es de transporte y sin
  // Postgres no se puede comprobar que la revocación de verdad deja el token sin servir.
  it('DELETE /auth/sesion con Content-Type JSON y sin cuerpo revoca: 204 y el token deja de servir', async () => {
    const cuenta = await registrar('logout-json')

    const antes = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: bearer(cuenta.token),
    })
    expect(antes.statusCode, antes.body).toBe(200)

    const cerrar = await app.inject({
      method: 'DELETE',
      url: '/auth/sesion',
      headers: { ...bearer(cuenta.token), 'content-type': 'application/json' },
    })
    expect(cerrar.statusCode, cerrar.body).toBe(204)
    expect(cerrar.body).toBe('')

    const despues = await app.inject({
      method: 'GET',
      url: '/auth/yo',
      headers: bearer(cuenta.token),
    })
    expect(despues.statusCode, 'el token revocado ya no sirve').toBe(401)
    expect(despues.json()).toStrictEqual({
      error: { code: 'no_autenticado', mensaje: 'Necesitás iniciar sesión.' },
    })
  })
})

/** La terminal que trae: cualquiera menos la que empujó, para que su propio libro no estorbe. */
function otraTerminal(terminal: string): string {
  return `${terminal}-lectora`
}
