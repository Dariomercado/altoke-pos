/**
 * Usuarios: la tabla es global (el email identifica a la persona) y el rol vive en `membresias`,
 * por tenant. `usuarios` no tiene RLS porque no es dato de un tenant: quién existe se decide por
 * email, y qué puede hacer se decide por membresía.
 */

import type { Consultable } from './db.ts'
import { primeraFila } from './db.ts'

export type Usuario = {
  readonly id: string
  readonly email: string
  readonly nombre: string
}

const SQL_POR_EMAIL = `SELECT id, email, nombre, password_hash FROM usuarios WHERE email = $1`

export async function buscarUsuarioPorEmail(
  consultable: Consultable,
  email: string,
): Promise<(Usuario & { readonly passwordHash: string }) | undefined> {
  const fila = (await consultable.query(SQL_POR_EMAIL, [email])).rows[0]
  if (fila === undefined) return undefined

  return {
    id: String(fila['id']),
    email: String(fila['email']),
    nombre: String(fila['nombre']),
    passwordHash: String(fila['password_hash']),
  }
}

export async function crearUsuario(
  conexion: Consultable,
  datos: { readonly email: string; readonly nombre: string; readonly passwordHash: string },
): Promise<Usuario> {
  const fila = primeraFila(
    await conexion.query(
      `INSERT INTO usuarios (email, nombre, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, nombre`,
      [datos.email, datos.nombre, datos.passwordHash],
    ),
  )
  return { id: String(fila['id']), email: String(fila['email']), nombre: String(fila['nombre']) }
}

/** `false` si el usuario no existe; el llamador decide qué error es. */
export async function actualizarPassword(
  conexion: Consultable,
  usuarioId: string,
  passwordHash: string,
): Promise<boolean> {
  const resultado = await conexion.query(
    `UPDATE usuarios SET password_hash = $2 WHERE id = $1 RETURNING id`,
    [usuarioId, passwordHash],
  )
  return resultado.rows.length > 0
}
