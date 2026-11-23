import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { descubrirMigraciones, leerMigraciones, ordenarMigraciones } from './migraciones.ts'

const scratch: string[] = []

function directorioCon(archivos: Record<string, string>): string {
  const directorio = mkdtempSync(join(tmpdir(), 'altoke-migraciones-'))
  scratch.push(directorio)
  for (const [nombre, contenido] of Object.entries(archivos)) {
    writeFileSync(join(directorio, nombre), contenido)
  }
  return directorio
}

afterEach(() => {
  for (const directorio of scratch.splice(0)) {
    rmSync(directorio, { recursive: true, force: true })
  }
})

describe('descubrirMigraciones', () => {
  it('devuelve los .sql en orden de nombre de archivo, no en orden de directorio', () => {
    const directorio = directorioCon({
      '0003_tercera.sql': 'SELECT 3;',
      '0001_primera.sql': 'SELECT 1;',
      '0010_decima.sql': 'SELECT 10;',
      '0002_segunda.sql': 'SELECT 2;',
      'README.md': '# no es una migración',
      '.DS_Store': '',
    })

    expect(descubrirMigraciones(directorio)).toStrictEqual([
      '0001_primera.sql',
      '0002_segunda.sql',
      '0003_tercera.sql',
      '0010_decima.sql',
    ])
  })

  it('devuelve una lista vacía cuando no hay migraciones', () => {
    expect(descubrirMigraciones(directorioCon({ 'notas.txt': 'hola' }))).toStrictEqual([])
  })
})

describe('ordenarMigraciones', () => {
  it('ordena por nombre y descarta lo que no es SQL', () => {
    expect(ordenarMigraciones(['0002_b.sql', 'inventario.csv', '0001_a.sql', 'b.sql'])).toStrictEqual([
      '0001_a.sql',
      '0002_b.sql',
      'b.sql',
    ])
  })

  it('no muta la lista que recibe', () => {
    const original = ['0002_b.sql', '0001_a.sql']
    ordenarMigraciones(original)
    expect(original).toStrictEqual(['0002_b.sql', '0001_a.sql'])
  })
})

describe('leerMigraciones', () => {
  it('devuelve nombre y SQL de cada migración, en orden', () => {
    const directorio = directorioCon({
      '0002_b.sql': 'CREATE TABLE b (id int);',
      '0001_a.sql': 'CREATE TABLE a (id int);',
    })

    expect(leerMigraciones(directorio)).toStrictEqual([
      { nombre: '0001_a.sql', sql: 'CREATE TABLE a (id int);' },
      { nombre: '0002_b.sql', sql: 'CREATE TABLE b (id int);' },
    ])
  })
})
