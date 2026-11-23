/**
 * Cadena de migraciones de `schemaVersion` (docs/specs/0003-api-y-sync.md §schemaVersion, T7 de
 * odd/tasks/altoke-m2-sync.md).
 *
 * Cada evento declara la versión con la que se escribió (`0001` §2). Al leerlo —en el servidor y en
 * la terminal, el mismo código porque este paquete es compartido— se aplica `vN → vN+1 → …` **en
 * memoria** hasta la versión de hoy, y recién entonces se valida con `validarEvento`. Lo guardado
 * no se reescribe nunca: la fila de una terminal vieja se sigue leyendo, y ningún `UPDATE` la
 * convierte en otra cosa.
 *
 * Tres decisiones que este archivo hace cumplir:
 *
 *   - **La cadena real está vacía hoy.** En M2 sólo existe `v1` y un paso inventado sin cambio real
 *     de esquema sería peor que ninguno: habría que mantenerlo para siempre y nadie sabría qué
 *     datos transforma. `CADENA_DE_MIGRACIONES` es la forma que va a tener el primer paso real, con
 *     su test, para que la primera migración no sea un descubrimiento.
 *   - **La cadena es inyectable.** `migrarEvento(evento, cadena)` toma la cadena por parámetro con
 *     la real por default: sin eso, con la cadena vacía no habría manera de ejercitar la
 *     composición, y una cadena que sólo ve un paso es una cadena que nadie probó.
 *   - **Una versión futura no se coercionа.** Un cuerpo de `vN+1` no se puede migrar "hacia atrás":
 *     aplicarle las reglas de hoy es corrupción silenciosa. Lanza `VersionDeSchemaFutura`, que es
 *     un error distinto de "el evento está mal".
 *
 * Nunca se muta el evento del llamador: la cadena trabaja sobre una copia y cada paso devuelve un
 * cuerpo nuevo. Un `ajuste_stock` aplicado dos veces, o un evento que se toca en memoria mientras la
 * fila sigue igual, es stock mal contado.
 */

import { SCHEMA_VERSION_ACTUAL, validarEvento } from './eventos.ts'
import type { Evento } from './eventos.ts'

/**
 * Un cuerpo de evento en memoria, sin tipar por versión.
 *
 * `Evento` es la forma de **hoy**: el cuerpo de una fila vieja no tiene por qué cumplirla — de eso
 * se trata migrar. Dentro de la cadena el cuerpo se trata como un registro cualquiera, y sólo se
 * convierte en `Evento` después de migrar y validar.
 */
export type CuerpoDeEvento = Record<string, unknown>

/**
 * Un paso de la cadena: exactamente `v(desde)` → `v(desde + 1)`.
 *
 * La versión la pone la cadena, no el paso (`migrarEvento` estampa `desde + 1` sobre lo que el
 * paso devuelva). Así un paso no puede declarar otro salto ni olvidarse de subir la versión: la
 * única forma de escribir un paso equivocado es devolver un cuerpo inválido, y eso lo agarra
 * `validarEvento`.
 */
export interface PasoDeMigracion {
  /** La versión de entrada. El paso produce `desde + 1`. */
  readonly desde: number
  /** Transforma el cuerpo y devuelve uno nuevo. */
  aplicar(evento: CuerpoDeEvento): CuerpoDeEvento
}

/** La cadena entera: hasta dónde llega y los pasos que la recorren. */
export interface CadenaDeMigraciones {
  /** La versión a la que se llega. La real es siempre `SCHEMA_VERSION_ACTUAL`. */
  readonly hasta: number
  readonly pasos: readonly PasoDeMigracion[]
}

/**
 * La cadena real. **Vacía a propósito**: en M2 sólo existe `v1` (0003 §schemaVersion).
 *
 * Ésta es la forma que va a tener el primer paso real —un `v1 → v2` que derive el campo nuevo—:
 *
 *     { desde: 1, aplicar: (evento) => ({ ...evento, campoNuevo: derivar(evento['campoViejo']) }) }
 *
 * El día que exista, se agrega acá y `migraciones.test.ts` deja de asumir que está vacía.
 */
export const CADENA_DE_MIGRACIONES: CadenaDeMigraciones = {
  hasta: SCHEMA_VERSION_ACTUAL,
  pasos: [],
}

/**
 * Una fila escrita por una versión más nueva que este código.
 *
 * Se lanza en vez de coercionar: aplicar un cuerpo con las reglas de otra versión produce eventos
 * que validan y mienten, y eso no se detecta nunca más.
 */
export class VersionDeSchemaFutura extends RangeError {
  /** La versión del evento, para que quien la atrape pueda decir cuál es. */
  readonly version: number

  constructor(version: number, hasta: number) {
    super(
      `schemaVersion v${version} es más nueva que la que este código entiende (hasta v${hasta}): ` +
        'no se migra hacia atrás.',
    )
    this.name = 'VersionDeSchemaFutura'
    this.version = version
  }
}

/** Una versión para la que la cadena no tiene paso: la cadena está incompleta, no el evento. */
export class MigracionAusente extends RangeError {
  readonly desde: number

  constructor(desde: number) {
    super(`No hay migración v${desde} → v${desde + 1}: la cadena de migraciones está incompleta.`)
    this.name = 'MigracionAusente'
    this.desde = desde
  }
}

/**
 * Un evento guardado: lo único que se sabe de entrada es la versión con la que se escribió.
 *
 * Acepta `unknown` a propósito: el cuerpo viene de una fila de Postgres, de IndexedDB o del cable,
 * y ninguno de los tres es de fiar. Lo que sale, en cambio, es un `Evento` validado.
 */
function copiaDeEvento(evento: unknown): CuerpoDeEvento {
  if (typeof evento !== 'object' || evento === null || Array.isArray(evento)) {
    throw new TypeError(`Un evento guardado debe ser un objeto: ${String(evento)}`)
  }

  // Copia profunda: el resultado no comparte estado con la entrada, así que ningún paso —ni el
  // llamador después— puede tocar el evento que se leyó de la fila.
  return structuredClone(evento) as CuerpoDeEvento
}

function versionDe(evento: CuerpoDeEvento): number {
  const version = evento['schemaVersion']

  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw new RangeError(`schemaVersion debe ser un entero positivo: ${String(version)}`)
  }

  return version
}

/**
 * Lleva un evento guardado a la versión de hoy, en memoria, y lo valida.
 *
 * Es el único camino de lectura: la terminal al aplicar la cola del servidor y el servidor al
 * devolverla (0003 §Sync). Con la cadena real de M2 —vacía— un `v1` sale idéntico: la cadena existe
 * para el día que no lo sea.
 */
export function migrarEvento(
  evento: unknown,
  cadena: CadenaDeMigraciones = CADENA_DE_MIGRACIONES,
): Evento {
  let cuerpo = copiaDeEvento(evento)
  let version = versionDe(cuerpo)

  if (version > cadena.hasta) throw new VersionDeSchemaFutura(version, cadena.hasta)

  while (version < cadena.hasta) {
    const paso = cadena.pasos.find((candidato) => candidato.desde === version)
    if (paso === undefined) throw new MigracionAusente(version)

    // El paso transforma el cuerpo; la versión la estampa la cadena (ver `PasoDeMigracion`).
    cuerpo = { ...paso.aplicar(cuerpo), schemaVersion: version + 1 }
    version += 1
  }

  const migrado = cuerpo as unknown as Evento
  validarEvento(migrado, cadena.hasta)

  return migrado
}
