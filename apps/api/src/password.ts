/**
 * Hash de contraseñas con `scrypt` de `node:crypto` (docs/specs/0003-api-y-sync.md §Auth).
 *
 * Sin Argon2 y sin bcrypt nativo: el VPS no compila dependencias nativas. `scrypt` viene en Node
 * y con N=2^14, r=8, p=1 tiene el costo que el spec pide.
 *
 * El registro se guarda **autodescriptivo**:
 *
 *     scrypt$N$r$p$sal$hash
 *
 * Los parámetros viajan con el hash. Subirlos mañana es una migración (rehashear al verificar),
 * no una reescritura de la tabla. `verificarPassword` deriva con los parámetros y el largo del
 * hash guardados, no con las constantes del día.
 */

import { randomBytes, scrypt as scryptNativo, timingSafeEqual } from 'node:crypto'

export type ParametrosScrypt = {
  readonly N: number
  readonly r: number
  readonly p: number
  readonly longitudSal: number
  readonly longitudHash: number
}

/** N=2^14, r=8, p=1, sal de 16 bytes (0003 §Auth). */
export const PARAMETROS_SCRYPT: ParametrosScrypt = {
  N: 2 ** 14,
  r: 8,
  p: 1,
  longitudSal: 16,
  longitudHash: 64,
}

export const PREFIJO_SCRYPT = 'scrypt'
export const LARGO_MINIMO_PASSWORD = 8
export const LARGO_MAXIMO_PASSWORD = 200
export const MENSAJE_PASSWORD_INVALIDA = `La contraseña tiene que tener entre ${LARGO_MINIMO_PASSWORD} y ${LARGO_MAXIMO_PASSWORD} caracteres.`

// scrypt necesita 128 * N * r bytes sólo para el buffer de trabajo (16 MiB con los parámetros de
// arriba). El default de Node son 32 MiB; se deja aire para una suba de parámetros.
const MAXMEM = 128 * 1024 * 1024

// Techo de los parámetros que se aceptan al verificar: un registro manipulado en la base no puede
// convertir cada login en un minuto de CPU.
const N_MAXIMO = 2 ** 20
const R_MAXIMO = 32
const P_MAXIMO = 16

function derivar(
  password: string,
  sal: Buffer,
  longitud: number,
  parametros: { readonly N: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scryptNativo(
      password,
      sal,
      longitud,
      { N: parametros.N, r: parametros.r, p: parametros.p, maxmem: MAXMEM },
      (error, clave) => {
        if (error) rechazar(error)
        else resolver(clave)
      },
    )
  })
}

/** Devuelve el registro autodescriptivo listo para `usuarios.password_hash`. */
export async function hashPassword(password: string): Promise<string> {
  const sal = randomBytes(PARAMETROS_SCRYPT.longitudSal)
  const clave = await derivar(password, sal, PARAMETROS_SCRYPT.longitudHash, PARAMETROS_SCRYPT)

  return [
    PREFIJO_SCRYPT,
    PARAMETROS_SCRYPT.N,
    PARAMETROS_SCRYPT.r,
    PARAMETROS_SCRYPT.p,
    sal.toString('base64'),
    clave.toString('base64'),
  ].join('$')
}

export type RegistroPassword = {
  readonly parametros: { readonly N: number; readonly r: number; readonly p: number }
  readonly sal: Buffer
  readonly clave: Buffer
}

function entero(valor: string | undefined, maximo: number): number | undefined {
  if (valor === undefined || !/^\d+$/.test(valor)) return undefined
  const numero = Number(valor)
  return Number.isSafeInteger(numero) && numero >= 1 && numero <= maximo ? numero : undefined
}

/** Parsea un registro. Devuelve `undefined` si no tiene la forma esperada. */
export function leerRegistroPassword(registro: string): RegistroPassword | undefined {
  const partes = registro.split('$')
  if (partes.length !== 6) return undefined
  const [prefijo, textoN, textoR, textoP, textoSal, textoClave] = partes
  if (prefijo !== PREFIJO_SCRYPT) return undefined

  const N = entero(textoN, N_MAXIMO)
  const r = entero(textoR, R_MAXIMO)
  const p = entero(textoP, P_MAXIMO)
  if (N === undefined || r === undefined || p === undefined) return undefined
  // N tiene que ser potencia de dos mayor que 1: es lo que scrypt acepta.
  if (N < 2 || (N & (N - 1)) !== 0) return undefined

  const sal = Buffer.from(textoSal ?? '', 'base64')
  const clave = Buffer.from(textoClave ?? '', 'base64')
  if (sal.length === 0 || clave.length === 0) return undefined

  return { parametros: { N, r, p }, sal, clave }
}

/**
 * Compara en tiempo constante (`timingSafeEqual`) contra el registro guardado. Un registro
 * corrupto devuelve `false`, nunca una excepción que se convierta en 500.
 */
export async function verificarPassword(password: string, registro: string): Promise<boolean> {
  const leido = leerRegistroPassword(registro)
  if (leido === undefined) return false

  const clave = await derivar(password, leido.sal, leido.clave.length, leido.parametros).catch(
    () => undefined,
  )
  if (clave === undefined || clave.length !== leido.clave.length) return false
  return timingSafeEqual(clave, leido.clave)
}

let hashSenuelo: string | undefined

/**
 * Deriva contra un hash de mentira. Se llama cuando el email no existe: sin esto, "no existe"
 * respondería en microsegundos y "existe" en decenas de milisegundos, y el tiempo sería un oráculo
 * de qué emails tienen cuenta.
 */
export async function verificarPasswordSenuelo(password: string): Promise<void> {
  hashSenuelo ??= await hashPassword('senuelo-de-altoke: ninguna contraseña real llega acá')
  await verificarPassword(password, hashSenuelo)
}
