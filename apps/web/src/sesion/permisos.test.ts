import { describe, expect, it } from 'vitest'
import { ROLES, puede } from './permisos.ts'
import type { AccionDePos, Rol } from './permisos.ts'

/**
 * Matriz de roles de `0001` §6 y `0003` §Auth:
 *   - `solo_lectura` no cobra ni abre el cierre ni toca la marca.
 *   - `cajero` cobra y cierra, pero no administra el tenant.
 *   - `admin` y `owner` hacen todo.
 */
const ACCIONES: readonly AccionDePos[] = ['cobrar', 'cerrar_caja', 'administrar_marca']

describe('permisos del POS por rol', () => {
  it('declara los cuatro roles del spec, por tenant y sin alias', () => {
    expect([...ROLES]).toEqual(['owner', 'admin', 'cajero', 'solo_lectura'])
  })

  it('solo_lectura no cobra, no cierra y no toca la marca', () => {
    expect(ACCIONES.filter((accion) => puede('solo_lectura', accion))).toEqual([])
  })

  it('cajero cobra y cierra, pero no administra la marca', () => {
    expect(puede('cajero', 'cobrar')).toBe(true)
    expect(puede('cajero', 'cerrar_caja')).toBe(true)
    expect(puede('cajero', 'administrar_marca')).toBe(false)
  })

  it('admin y owner pueden las tres acciones', () => {
    for (const rol of ['admin', 'owner'] satisfies readonly Rol[]) {
      expect(ACCIONES.filter((accion) => !puede(rol, accion))).toEqual([])
    }
  })
})
