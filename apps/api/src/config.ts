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
  /**
   * Orígenes de tenant declarados para CORS (`0003` §Infraestructura). Lista vacía es "ninguno":
   * no hay comodín, ni por defecto ni por omisión.
   */
  readonly origenesPermitidos: readonly string[]
}

export const VARIABLE_ORIGENES = 'CORS_ORIGINS'
export const AYUDA_ORIGENES =
  `${VARIABLE_ORIGENES}=https://kiosco.altoke.app,https://otro.altoke.app ` +
  '(orígenes completos, separados por coma; sin comodines)'

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
    origenesPermitidos: leerOrigenesPermitidos(entorno),
  }
}

/**
 * Los orígenes de tenant declarados (`0003` §Infraestructura).
 *
 * CORS es explícito: sólo estos orígenes, con credenciales. **`*` se rechaza**, no se ignora: un
 * comodín con `Access-Control-Allow-Credentials` es inválido en el navegador y, si se colara, haría
 * que cualquier página pueda hablarle a la API con la sesión de un cajero. Un origen con path,
 * query o credenciales también se rechaza: `new URL` lo normalizaría a un origen que no es el que
 * el humano declaró.
 *
 * Lista vacía es legítima: ningún origen de navegador puede llamar a la API (curl y server-to-server
 * no mandan `Origin` y no pasan por CORS).
 */
export function leerOrigenesPermitidos(entorno: Entorno): readonly string[] {
  const crudo = texto(entorno.CORS_ORIGINS)
  if (crudo === undefined) return []

  const permitidos: string[] = []
  for (const parte of crudo.split(',')) {
    const origen = parte.trim()
    if (origen === '') continue

    const normalizado = normalizarOrigen(origen)
    if (!permitidos.includes(normalizado)) permitidos.push(normalizado)
  }

  return permitidos
}

function normalizarOrigen(origen: string): string {
  if (origen === '*') {
    throw new Error(
      `${VARIABLE_ORIGENES} no admite "*": CORS es explícito y con credenciales. ` +
        `Declará cada origen de tenant, por ejemplo ${AYUDA_ORIGENES}.`,
    )
  }

  let url: URL
  try {
    url = new URL(origen)
  } catch {
    throw new Error(
      `Origen inválido en ${VARIABLE_ORIGENES}: "${origen}". Tiene que ser un origen absoluto, ` +
        `por ejemplo ${AYUDA_ORIGENES}.`,
    )
  }

  const sinBarraFinal = origen.replace(/\/+$/, '')
  if (
    url.origin !== sinBarraFinal ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error(
      `Origen inválido en ${VARIABLE_ORIGENES}: "${origen}". Sólo el origen (esquema y host), ` +
        `sin path, query ni credenciales: ${AYUDA_ORIGENES}.`,
    )
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(
      `Origen inválido en ${VARIABLE_ORIGENES}: "${origen}". El esquema tiene que ser https: ` +
        '(o http: en localhost).',
    )
  }

  if (url.protocol !== 'https:' && !esLocal(url.hostname)) {
    throw new Error(
      `Origen inválido en ${VARIABLE_ORIGENES}: "${origen}". Fuera de localhost tiene que ser ` +
        'https: el POS vive en otro origen y el token de sesión viaja en cada pedido.',
    )
  }

  return url.origin
}

function esLocal(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
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
