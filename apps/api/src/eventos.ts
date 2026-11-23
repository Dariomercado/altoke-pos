/**
 * Eventos y acuses en Postgres (docs/specs/0003-api-y-sync.md §Sync).
 *
 * Reglas que este archivo hace cumplir:
 *
 *   - **La idempotencia la arbitra la base, no una consulta previa.** El evento se inserta con
 *     `ON CONFLICT (tenant_id, terminal_id, secuencia) DO NOTHING` y después se relee lo guardado:
 *     entre el `SELECT` y el `INSERT` de un "si no existe, insertalo" cabe otra terminal.
 *   - **Nada se reescribe.** Un evento con la misma clave y otro cuerpo es un conflicto que se
 *     reporta; un `id` ya usado en otra secuencia se rechaza. La fila guardada nunca cambia.
 *   - **El acuse es el máximo contiguo**, no el máximo. Un hueco es dato que la terminal todavía
 *     debe: acusar más allá le diría que deje de reenviar eventos que nunca llegaron.
 *   - **`recibido_en` es el cursor de la traída y es único por tenant.** `now()` es el reloj de la
 *     transacción, así que un lote entero compartiría el valor y `recibido_en > desde` perdería a
 *     los empatados al cortar una página (0005_eventos_recibido_en_unico.sql).
 *
 * Todas las funciones se llaman **dentro** de una transacción con `app.tenant_id` seteado
 * (`enTransaccionDeTenant`): RLS es la red de seguridad y además cada consulta filtra por
 * `tenant_id` explícito (0001 §6).
 */

import type { EventoSync } from '@altoke/contracts'
import type { Consultable, ResultadoConsulta } from './db.ts'
import { restriccionUnica } from './db.ts'

/** Tope de una página de `GET /sync/eventos`. */
export const LIMITE_PAGINA = 200

/**
 * Tope de `huecos` en la respuesta del empuje. Un salto de 1 a 10^9 no puede convertirse en una
 * respuesta de mil millones de números; `acuse.ultimaSecuencia` ya dice exactamente dónde está el
 * primer hueco, que es lo que la terminal necesita para reenviar.
 */
export const MAXIMO_HUECOS = 200

/** Colisiones del reloj al asignar `recibido_en`. Tres ya es una anomalía, no un caso normal. */
const INTENTOS_DE_INSERCION = 3

export const MENSAJE_CONFLICTO_CUERPO =
  'La secuencia ya existe con otro cuerpo: el servidor guarda el primero y no lo reescribe.'
export const MENSAJE_CONFLICTO_ID =
  'Ese id ya lo usa otro evento: el servidor nunca reescribe un evento.'

export type Referencia = { readonly id: string; readonly secuencia: number }
export type Conflicto = Referencia & { readonly motivo: string }

/** Lo que pasó con un evento del lote. `aceptado` es el único que escribe una fila nueva. */
export type ResultadoDeGuardado =
  | { readonly tipo: 'aceptado' }
  | { readonly tipo: 'duplicado' }
  | { readonly tipo: 'conflicto'; readonly motivo: string }

/**
 * JSON canónico: objetos con las claves ordenadas. `jsonb` **no** conserva el orden en que se
 * escribieron las claves, así que comparar `JSON.stringify` contra lo releído daría distinto para el
 * mismo cuerpo y todo reintento sería un falso conflicto.
 */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`

  if (valor !== null && typeof valor === 'object') {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, dato]) => dato !== undefined)
      .sort(([uno], [otro]) => (uno < otro ? -1 : uno > otro ? 1 : 0))
    return `{${entradas.map(([clave, dato]) => `${JSON.stringify(clave)}:${canonico(dato)}`).join(',')}}`
  }

  return JSON.stringify(valor) ?? 'null'
}

/**
 * `recibido_en` estrictamente creciente por tenant, calculado en el mismo `INSERT`.
 *
 * `GREATEST(clock_timestamp(), max(recibido_en) + 1 µs)` ordena también dentro del lote (cada
 * evento es un `INSERT` propio y ve los anteriores de su transacción) y deja el único caso difícil
 * —dos transacciones concurrentes con el mismo microsegundo— al índice único, que el llamador
 * resuelve reintentando: el reloj del servidor no retrocede, así que el segundo intento gana.
 */
const SQL_INSERTAR = `INSERT INTO eventos
  (id, tenant_id, terminal_id, secuencia, tipo, ocurrido_en, schema_version, cuerpo, recibido_en)
SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7, $8::jsonb,
       GREATEST(
         clock_timestamp(),
         COALESCE((SELECT max(recibido_en) + interval '1 microsecond'
                   FROM eventos WHERE tenant_id = $2), to_timestamp(0))
       )
ON CONFLICT (tenant_id, terminal_id, secuencia) DO NOTHING
RETURNING id, secuencia`

const SQL_BUSCAR = `SELECT id, secuencia, cuerpo FROM eventos
WHERE tenant_id = $1 AND terminal_id = $2 AND secuencia = $3`

const SQL_ACUSE = `SELECT COALESCE(max(secuencia), 0)::bigint AS maxima, count(*)::int AS total
FROM eventos WHERE tenant_id = $1 AND terminal_id = $2`

/**
 * Los números que faltan entre 1 y la secuencia más alta, acotados. `lag` con default 0 convierte
 * "el primero guardado no es 1" en el hueco inicial, sin un caso aparte.
 */
const SQL_HUECOS = `WITH ordenadas AS (
  SELECT secuencia, lag(secuencia, 1, 0) OVER (ORDER BY secuencia) AS previa
  FROM eventos WHERE tenant_id = $1 AND terminal_id = $2
)
SELECT g AS faltante
FROM ordenadas
CROSS JOIN LATERAL generate_series(previa + 1, secuencia - 1) AS g
ORDER BY faltante
LIMIT $3`

const SQL_REGISTRAR_ACUSE = `INSERT INTO acuses (tenant_id, terminal_id, ultima_secuencia)
VALUES ($1, $2, $3)
ON CONFLICT (tenant_id, terminal_id) DO UPDATE
SET ultima_secuencia = GREATEST(acuses.ultima_secuencia, EXCLUDED.ultima_secuencia)`

/**
 * `recibido_en` viaja como ISO con microsegundos, no como el `Date` de node-pg: `toISOString()`
 * corta en milisegundos y un cursor truncado deja al evento de la frontera del lado de "todavía
 * después del cursor", que es un evento repetido en la página siguiente (y un `ajuste_stock` dos
 * veces es stock mal contado).
 */
const RECIBIDO_ISO = `to_char(recibido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const SQL_TRAER = `SELECT id, cuerpo, ${RECIBIDO_ISO} AS recibido FROM eventos
WHERE tenant_id = $1 AND terminal_id <> $2
ORDER BY recibido_en, id
LIMIT $3`

const SQL_TRAER_DESDE = `SELECT id, cuerpo, ${RECIBIDO_ISO} AS recibido FROM eventos
WHERE tenant_id = $1 AND terminal_id <> $2 AND recibido_en > $3::timestamptz
ORDER BY recibido_en, id
LIMIT $4`

export type Acuse = {
  readonly ultimaSecuencia: number
  readonly huecos: readonly number[]
}

function aEntero(valor: unknown): number {
  return typeof valor === 'number' ? valor : Number(valor ?? 0)
}

function aTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor
  throw new Error('la fila del evento no devolvió su recibido_en')
}

/** El nombre del índice único de `recibido_en`, para distinguir una colisión de reloj de un `id` usado. */
const INDICE_RECIBIDO_UNICO = 'eventos_tenant_recibido_en_unico'
const RESTRICCION_ID = 'eventos_id_key'

/**
 * Inserta el evento o dice por qué no. Nunca pisa una fila existente.
 *
 * El `SAVEPOINT` es lo que permite seguir con el resto del lote después de una violación de
 * unicidad: sin él, un `23505` deja la transacción entera abortada y un solo evento con el `id`
 * repetido tiraría abajo a sus hermanos válidos.
 */
export async function guardarEvento(
  conexion: Consultable,
  tenantId: string,
  evento: EventoSync,
): Promise<ResultadoDeGuardado> {
  for (let intento = 1; intento <= INTENTOS_DE_INSERCION; intento += 1) {
    await conexion.query('SAVEPOINT evento')

    let insertado: ResultadoConsulta
    try {
      insertado = await conexion.query(SQL_INSERTAR, [
        evento.id,
        tenantId,
        evento.terminalId,
        evento.secuencia,
        evento.tipo,
        evento.ocurridoEn,
        evento.schemaVersion,
        JSON.stringify(evento),
      ])
    } catch (error) {
      const restriccion = restriccionUnica(error)
      if (restriccion === undefined) throw error

      await conexion.query('ROLLBACK TO SAVEPOINT evento')
      if (restriccion === INDICE_RECIBIDO_UNICO) continue
      if (restriccion === RESTRICCION_ID) return { tipo: 'conflicto', motivo: MENSAJE_CONFLICTO_ID }
      throw error
    }

    if (insertado.rows.length > 0) {
      await conexion.query('RELEASE SAVEPOINT evento')
      return { tipo: 'aceptado' }
    }

    const resultado = await compararConLoGuardado(conexion, tenantId, evento)
    await conexion.query('RELEASE SAVEPOINT evento')
    return resultado
  }

  throw new Error(`eventos: no se pudo asignar recibido_en después de ${INTENTOS_DE_INSERCION} intentos`)
}

/**
 * Lo que ya estaba en `(tenant, terminal, secuencia)`. Mismo cuerpo canónico e id → duplicado
 * (un reintento tras una respuesta perdida); cualquier otra cosa → conflicto, y el guardado manda.
 */
async function compararConLoGuardado(
  conexion: Consultable,
  tenantId: string,
  evento: EventoSync,
): Promise<ResultadoDeGuardado> {
  const fila = (await conexion.query(SQL_BUSCAR, [tenantId, evento.terminalId, evento.secuencia]))
    .rows[0]

  // Sin fila en esa clave: el único que impidió el `INSERT` fue el índice único de `eventos.id`.
  if (fila === undefined) return { tipo: 'conflicto', motivo: MENSAJE_CONFLICTO_ID }

  const guardado = fila['cuerpo']
  const mismoId = String(fila['id']) === evento.id
  if (mismoId && canonico(guardado) === canonico(evento)) return { tipo: 'duplicado' }

  return {
    tipo: 'conflicto',
    motivo: mismoId ? MENSAJE_CONFLICTO_CUERPO : MENSAJE_CONFLICTO_ID,
  }
}

/** El máximo contiguo desde 1 y los huecos que se ven hasta la secuencia más alta. */
export async function acuseDeTerminal(
  conexion: Consultable,
  tenantId: string,
  terminalId: string,
): Promise<Acuse> {
  const fila = (await conexion.query(SQL_ACUSE, [tenantId, terminalId])).rows[0]
  const maxima = aEntero(fila?.['maxima'])
  const total = aEntero(fila?.['total'])

  // Secuencias distintas y positivas: si la cantidad iguala al máximo, son exactamente 1..máximo.
  if (total === maxima) return { ultimaSecuencia: maxima, huecos: [] }

  const huecos = (await conexion.query(SQL_HUECOS, [tenantId, terminalId, MAXIMO_HUECOS])).rows.map(
    (hueco) => aEntero(hueco['faltante']),
  )
  const primero = huecos[0]

  return { ultimaSecuencia: primero === undefined ? maxima : primero - 1, huecos }
}

/**
 * Persiste el acuse sin retroceder nunca: un `GET` no lo toca y un empuje con huecos nuevos no
 * puede bajar lo que ya se había acusado.
 */
export async function registrarAcuse(
  conexion: Consultable,
  tenantId: string,
  terminalId: string,
  ultimaSecuencia: number,
): Promise<void> {
  await conexion.query(SQL_REGISTRAR_ACUSE, [tenantId, terminalId, ultimaSecuencia])
}

export type Traida = {
  readonly eventos: readonly EventoSync[]
  readonly hayMas: boolean
  /** El `desde` de la página siguiente, o `null` si no hay más (0003 §Traer). */
  readonly siguienteDesde: string | null
}

export type OpcionesDeTraida = {
  readonly tenantId: string
  /** La terminal que pide: sus propios eventos ya están en su libro, así que se excluyen. */
  readonly terminalId: string
  readonly desde: string | undefined
}

/**
 * Los eventos del tenant posteriores al cursor, sin los de la terminal que pide, en el orden del
 * cursor del servidor `(recibido_en, id)`. Pide una fila de más: `hayMas` es la existencia de la
 * página siguiente, no una cuenta que pueda quedar desactualizada.
 */
export async function traerEventos(
  conexion: Consultable,
  opciones: OpcionesDeTraida,
): Promise<Traida> {
  const limite = LIMITE_PAGINA + 1
  const resultado =
    opciones.desde === undefined
      ? await conexion.query(SQL_TRAER, [opciones.tenantId, opciones.terminalId, limite])
      : await conexion.query(SQL_TRAER_DESDE, [
          opciones.tenantId,
          opciones.terminalId,
          opciones.desde,
          limite,
        ])

  const pagina = resultado.rows.slice(0, LIMITE_PAGINA)
  const hayMas = resultado.rows.length > LIMITE_PAGINA
  const ultima = pagina[pagina.length - 1]

  return {
    eventos: pagina.map((fila) => fila['cuerpo'] as EventoSync),
    hayMas,
    siguienteDesde: hayMas && ultima !== undefined ? aTexto(ultima['recibido']) : null,
  }
}
