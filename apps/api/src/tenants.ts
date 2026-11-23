/**
 * Tenants, membresías y sucursales.
 *
 * Dos capas de aislamiento (0001 §6): RLS en la base como red de seguridad y el filtro explícito
 * por `tenant_id` en cada consulta. Las funciones de acá se llaman **dentro** de una transacción
 * con `app.tenant_id` (o `app.usuario_id`) seteado: fuera de ella, RLS devuelve 0 filas y el
 * código lo tomaría como "no existe", que es la mentira que el spec prohíbe.
 */

import type { Consultable } from './db.ts'
import { primeraFila } from './db.ts'
import { esRol } from './roles.ts'
import type { Rol } from './roles.ts'

export type Tenant = {
  readonly id: string
  readonly slug: string
  readonly nombre: string
}

export type Membresia = Tenant & {
  readonly tenantId: string
  readonly rol: Rol
}

const SQL_TENANT = `SELECT id, slug, nombre
FROM tenants
WHERE slug = $1 OR id::text = $1
ORDER BY (slug = $1) DESC
LIMIT 1`

/**
 * Por slug (lo que usa el cliente y la ruta) o por id. `id::text` evita el cast que explotaría
 * con un slug cualquiera. `tenants` no tiene RLS: es la tabla que dice qué tenants existen y se
 * consulta antes de elegir el tenant de la conexión.
 */
export async function buscarTenant(
  consultable: Consultable,
  slugOId: string,
): Promise<Tenant | undefined> {
  const fila = (await consultable.query(SQL_TENANT, [slugOId])).rows[0]
  if (fila === undefined) return undefined

  return {
    id: String(fila['id']),
    slug: String(fila['slug']),
    nombre: String(fila['nombre']),
  }
}

export async function crearTenant(
  conexion: Consultable,
  datos: { readonly slug: string; readonly nombre: string },
): Promise<Tenant> {
  const fila = primeraFila(
    await conexion.query(
      `INSERT INTO tenants (slug, nombre) VALUES ($1, $2) RETURNING id, slug, nombre`,
      [datos.slug, datos.nombre],
    ),
  )
  return { id: String(fila['id']), slug: String(fila['slug']), nombre: String(fila['nombre']) }
}

const SQL_MEMBRESIA = `SELECT rol FROM membresias WHERE usuario_id = $1 AND tenant_id = $2`

/** El rol del usuario en ese tenant, o `undefined` si no es miembro. Requiere `app.tenant_id`. */
export async function buscarMembresia(
  consultable: Consultable,
  usuarioId: string,
  tenantId: string,
): Promise<Rol | undefined> {
  const fila = (await consultable.query(SQL_MEMBRESIA, [usuarioId, tenantId])).rows[0]
  const rol = fila?.['rol']
  return esRol(rol) ? rol : undefined
}

const SQL_MEMBRESIAS = `SELECT m.tenant_id, m.rol, t.slug, t.nombre
FROM membresias m
JOIN tenants t ON t.id = m.tenant_id
WHERE m.usuario_id = $1
ORDER BY t.creado_en, t.id`

/**
 * Todas las membresías del usuario. Requiere `app.usuario_id`: la política `membresias_propias`
 * es la que deja leer las propias sin tener que elegir un tenant antes de saber cuáles hay.
 */
export async function listarMembresias(
  consultable: Consultable,
  usuarioId: string,
): Promise<Membresia[]> {
  const filas = (await consultable.query(SQL_MEMBRESIAS, [usuarioId])).rows

  return filas.flatMap((fila) => {
    const rol = fila['rol']
    if (!esRol(rol)) return []
    const tenantId = String(fila['tenant_id'])
    return [{ tenantId, id: tenantId, slug: String(fila['slug']), nombre: String(fila['nombre']), rol }]
  })
}

export async function agregarMembresia(
  conexion: Consultable,
  datos: { readonly usuarioId: string; readonly tenantId: string; readonly rol: Rol },
): Promise<void> {
  await conexion.query(
    `INSERT INTO membresias (usuario_id, tenant_id, rol) VALUES ($1, $2, $3)`,
    [datos.usuarioId, datos.tenantId, datos.rol],
  )
}

const SQL_SUCURSAL_POR_NOMBRE = `SELECT id, nombre FROM sucursales
WHERE tenant_id = $1 AND lower(nombre) = lower($2)
ORDER BY id
LIMIT 1`

export type Sucursal = {
  readonly id: string
  readonly nombre: string
}

/**
 * La sucursal con ese nombre en el tenant, o la crea. `sucursal` llega como nombre en
 * `POST /tenants/:slug/terminales` y el alta del tenant ya crea "Principal": reusar la misma
 * función evita dos sucursales "Principal" con distinta capitalización.
 */
export async function asegurarSucursal(
  conexion: Consultable,
  tenantId: string,
  nombre: string,
): Promise<Sucursal> {
  const existente = (await conexion.query(SQL_SUCURSAL_POR_NOMBRE, [tenantId, nombre])).rows[0]
  if (existente !== undefined) {
    return { id: String(existente['id']), nombre: String(existente['nombre']) }
  }

  const fila = primeraFila(
    await conexion.query(
      `INSERT INTO sucursales (tenant_id, nombre) VALUES ($1, $2) RETURNING id, nombre`,
      [tenantId, nombre],
    ),
  )
  return { id: String(fila['id']), nombre: String(fila['nombre']) }
}
