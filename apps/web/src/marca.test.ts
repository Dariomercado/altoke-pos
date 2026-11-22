// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { variablesDeMarca } from '@altoke/ui'
import { MARCA_INICIAL, aplicarMarca, cargarMarca, guardarMarca } from './marca'

const TENANT = 'kiosco-1'
const CLAVE = `altoke:marca:${TENANT}`

const MARCA_DEL_LOCAL = {
  primary: '#e11d48',
  accent: '#f97316',
  surface: '#fbf8ff',
  text: '#1b1b21',
  logoUrl: 'https://cdn.test/logo.svg',
} as const

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('marca — persistencia por tenant', () => {
  it('guarda y recupera la marca de cada tenant por separado', () => {
    guardarMarca(TENANT, MARCA_DEL_LOCAL)

    expect(cargarMarca(TENANT)).toEqual(MARCA_DEL_LOCAL)
    expect(cargarMarca('otro-kiosco')).toEqual(MARCA_INICIAL)
    expect(localStorage.getItem(CLAVE)).not.toBeNull()
  })

  it('sin nada guardado devuelve la marca inicial', () => {
    expect(cargarMarca(TENANT)).toEqual(MARCA_INICIAL)
  })

  it('una entrada corrupta cae a la marca inicial en vez de romper el arranque', () => {
    for (const basura of ['no es json', '42', 'null', '[]']) {
      localStorage.setItem(CLAVE, basura)
      expect(cargarMarca(TENANT), basura).toEqual(MARCA_INICIAL)
    }
  })

  it('una entrada parcial nunca devuelve campos undefined', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ primary: '#E11D48', surface: 7, text: null }))

    const marca = cargarMarca(TENANT)

    expect(marca.primary).toBe('#e11d48')
    expect(marca.accent).toBe(MARCA_INICIAL.accent)
    expect(marca.surface).toBe('#fbf8ff')
    expect(marca.text).toBe('#1b1b21')
    expect(marca.logoUrl).toBeUndefined()
  })
})

describe('marca — aplicación de las variables', () => {
  it('escribe cada variable de marca en la raíz que recibe', () => {
    const raiz = document.createElement('div')
    const marca = { ...MARCA_INICIAL, primary: '#e11d48', accent: '#f97316' }

    aplicarMarca(marca, raiz)

    for (const [propiedad, valor] of Object.entries(variablesDeMarca(marca))) {
      expect(raiz.style.getPropertyValue(propiedad), propiedad).toBe(valor)
    }
    expect(raiz.style.getPropertyValue('--brand-surface')).toBe('#fbf8ff')
    expect(raiz.style.getPropertyValue('--brand-text')).toBe('#1b1b21')
  })

  it('un logo con esquema no permitido no se aplica y borra el anterior', () => {
    const raiz = document.createElement('div')

    aplicarMarca({ ...MARCA_INICIAL, logoUrl: 'https://cdn.test/logo.svg' }, raiz)
    expect(raiz.style.getPropertyValue('--brand-logo')).toBe('https://cdn.test/logo.svg')

    aplicarMarca({ ...MARCA_INICIAL, logoUrl: 'javascript:alert(1)' }, raiz)
    expect(raiz.style.getPropertyValue('--brand-logo')).toBe('')
  })

  it('sin raíz explícita aplica sobre el documento', () => {
    aplicarMarca({ ...MARCA_INICIAL, primary: '#0d9488' })

    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('#0d9488')
  })
})
