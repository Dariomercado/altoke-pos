import { describe, expect, it } from 'vitest'
import { ROLES, RANGO_ROL, esRol, rolAlcanza } from './roles.ts'

describe('roles', () => {
  it('son los cuatro de 0001 §6, por tenant', () => {
    expect(ROLES).toStrictEqual(['solo_lectura', 'cajero', 'admin', 'owner'])
    expect(Object.keys(RANGO_ROL)).toStrictEqual([...ROLES])
  })

  it('el rango alcanza hacia abajo y nunca hacia arriba', () => {
    expect(rolAlcanza('owner', 'admin')).toBe(true)
    expect(rolAlcanza('admin', 'cajero')).toBe(true)
    expect(rolAlcanza('cajero', 'solo_lectura')).toBe(true)
    expect(rolAlcanza('solo_lectura', 'cajero')).toBe(false)
    expect(rolAlcanza('cajero', 'admin')).toBe(false)
    expect(rolAlcanza('admin', 'owner')).toBe(false)
  })

  it('reconoce un rol guardado y rechaza cualquier otra cosa', () => {
    expect(esRol('cajero')).toBe(true)
    expect(esRol('superadmin')).toBe(false)
    expect(esRol(undefined)).toBe(false)
    expect(esRol(3)).toBe(false)
  })
})
