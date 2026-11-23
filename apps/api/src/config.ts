/**
 * Configuración por entorno, con validación que falla antes de abrir nada.
 *
 * Sin `dotenv`: el proceso se arranca con variables de entorno o con `node --env-file=.env
 * src/index.ts` (Node ≥ 20.6). Una dependencia menos y el mismo resultado.
 */

export const PUERTO_POR_DEFECTO = 3001
export const ENTORNO_POR_DEFECTO = 'development'

/** El entorno tal cual llega: `process.env` o cualquier objeto equivalente. */
export type Entorno = Record<string, string | undefined>

export type Config = {
  readonly databaseUrl: string
  /** Dueño del esquema: DDL y migraciones. Por defecto, la misma que `databaseUrl`. */
  readonly migracionesDatabaseUrl: string
  readonly port: number
  readonly nodeEnv: string
}

const AYUDA_DATABASE_URL =
  'DATABASE_URL=postgres://altoke_app:altoke_app@localhost:5435/altoke (el rol sin dueño con el ' +
  'que atiende la API; o arrancá con `node --env-file=.env src/index.ts`)'

export function leerConfig(entorno: Entorno): Config {
  const databaseUrl = entorno.DATABASE_URL?.trim()
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error(
      'Falta DATABASE_URL: sin ella el pool de pg no sabe a qué base conectarse. ' +
        `Definila como ${AYUDA_DATABASE_URL}.`,
    )
  }

  return {
    databaseUrl,
    // Las migraciones necesitan DDL, y el rol de la API no la tiene: se puede apuntar a otra
    // credencial (el dueño) y el runtime sigue usando `DATABASE_URL`. Si falta, es la misma.
    migracionesDatabaseUrl: texto(entorno.MIGRATIONS_DATABASE_URL) ?? databaseUrl,
    port: leerPuerto(entorno.PORT),
    nodeEnv: texto(entorno.NODE_ENV) ?? ENTORNO_POR_DEFECTO,
  }
}

function leerPuerto(valor: string | undefined): number {
  const textoPuerto = texto(valor)
  if (textoPuerto === undefined) return PUERTO_POR_DEFECTO

  const puerto = Number(textoPuerto)
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new Error(`PORT inválido: "${textoPuerto}". Tiene que ser un entero entre 1 y 65535.`)
  }
  return puerto
}

function texto(valor: string | undefined): string | undefined {
  const limpio = valor?.trim()
  return limpio === undefined || limpio === '' ? undefined : limpio
}
