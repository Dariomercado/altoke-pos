/**
 * Sesiones opacas (docs/specs/0003-api-y-sync.md §Auth).
 *
 * El token son 32 bytes aleatorios en base64url y se le muestra al cliente **una sola vez**. El
 * servidor guarda sólo su SHA-256: quien lea `sesiones` no tiene con qué entrar. Vida 12 h (un
 * turno) y revocable (`revocada_en`).
 */

import { createHash, randomBytes } from 'node:crypto'
import type { Consultable } from './db.ts'

export const LARGO_TOKEN_BYTES = 32
export const HORAS_DE_SESION = 12

/** 32 bytes en base64url sin padding: 43 caracteres de este alfabeto. */
const PATRON_TOKEN = /^[A-Za-z0-9_-]{43}$/

export function generarToken(): string {
  return randomBytes(LARGO_TOKEN_BYTES).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Descarta basura antes de ir a la base: un token que no tiene la forma no puede existir. */
export function esTokenConForma(token: string): boolean {
  return PATRON_TOKEN.test(token)
}

export type Sesion = {
  readonly tokenHash: string
  readonly usuarioId: string
  readonly tenantId: string
  readonly email: string
  readonly nombre: string
}

export type DatosSesion = {
  readonly tokenHash: string
  readonly usuarioId: string
  readonly tenantId: string
}

const SQL_INSERTAR = `INSERT INTO sesiones (token_hash, usuario_id, tenant_id, expira_en)
VALUES ($1, $2, $3, now() + interval '${HORAS_DE_SESION} hours')
RETURNING expira_en`

const SQL_BUSCAR = `SELECT s.usuario_id, s.tenant_id, u.email, u.nombre
FROM sesiones s
JOIN usuarios u ON u.id = s.usuario_id
WHERE s.token_hash = $1 AND s.revocada_en IS NULL AND s.expira_en > now()`

const SQL_REVOCAR = `UPDATE sesiones SET revocada_en = now()
WHERE token_hash = $1 AND revocada_en IS NULL`

/**
 * Sin token que conservar se pasa `''`: ningún `token_hash` real es vacío, así que caen todas.
 * La alternativa (`$2::text IS NULL`) le pide a Postgres que adivine el tipo de un parámetro nulo.
 */
const SQL_REVOCAR_DEL_USUARIO = `UPDATE sesiones SET revocada_en = now()
WHERE usuario_id = $1 AND revocada_en IS NULL AND token_hash <> $2`

/**
 * Inserta la sesión y devuelve su vencimiento. La fecha la calcula Postgres: una sola noción del
 * tiempo del lado del servidor.
 */
export async function insertarSesion(conexion: Consultable, datos: DatosSesion): Promise<string> {
  const resultado = await conexion.query(SQL_INSERTAR, [
    datos.tokenHash,
    datos.usuarioId,
    datos.tenantId,
  ])
  const expiraEn = resultado.rows[0]?.['expira_en']
  return aIso(expiraEn)
}

/**
 * La sesión vigente o `undefined`. Expiración y revocación se filtran en el SQL: no hay forma de
 * que un token vencido llegue al resto del código.
 */
export async function buscarSesionActiva(
  consultable: Consultable,
  tokenHash: string,
): Promise<Sesion | undefined> {
  const resultado = await consultable.query(SQL_BUSCAR, [tokenHash])
  const fila = resultado.rows[0]
  if (fila === undefined) return undefined

  return {
    tokenHash,
    usuarioId: String(fila['usuario_id']),
    tenantId: String(fila['tenant_id']),
    email: String(fila['email']),
    nombre: String(fila['nombre']),
  }
}

export async function revocarSesion(consultable: Consultable, tokenHash: string): Promise<void> {
  await consultable.query(SQL_REVOCAR, [tokenHash])
}

/**
 * Revoca **todas** las sesiones vigentes de un usuario, salvo la del token que se pase.
 *
 * Un reset de contraseña invalida la credencial: lo que se firmó con la vieja deja de servir en el
 * acto. El actor conserva la sesión desde la que resetea su propia contraseña, porque echarlo de la
 * pantalla que está usando no protege nada.
 */
export async function revocarSesionesDeUsuario(
  consultable: Consultable,
  usuarioId: string,
  conservarTokenHash?: string,
): Promise<void> {
  await consultable.query(SQL_REVOCAR_DEL_USUARIO, [usuarioId, conservarTokenHash ?? ''])
}

function aIso(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === 'string') return new Date(valor).toISOString()
  throw new Error('la sesión no devolvió su vencimiento')
}
