import { describe, expect, it } from 'vitest'
import {
  ENTORNO_POR_DEFECTO,
  PUERTO_POR_DEFECTO,
  leerConfig,
  leerOrigenesPermitidos,
} from './config.ts'

const BASE = { DATABASE_URL: 'postgres://altoke_app:altoke_app@localhost:5435/altoke' }
const URL_DUENIO = 'postgres://altoke:altoke@localhost:5435/altoke'

describe('leerConfig', () => {
  it('falla sin DATABASE_URL y nombra la variable que falta', () => {
    for (const entorno of [
      {},
      { PORT: '4000' },
      { DATABASE_URL: '' },
      { DATABASE_URL: '   ' },
      { PORT: '4000', NODE_ENV: 'production' },
    ]) {
      expect(() => leerConfig(entorno), `debería fallar con ${JSON.stringify(entorno)}`).toThrow(
        /DATABASE_URL/,
      )
    }
  })

  it('dice cómo se define DATABASE_URL, no sólo que falta', () => {
    expect(() => leerConfig({})).toThrow(/DATABASE_URL=postgres/)
    expect(() => leerConfig({})).toThrow(/--env-file/)
  })

  it('la ayuda nombra el puerto libre de este compose (5435) y no el 5433 de otro contenedor', () => {
    expect(() => leerConfig({})).toThrow(/5435/)
    expect(() => leerConfig({})).not.toThrow(/5433/)
  })

  it('usa 3001 y development cuando no hay PORT ni NODE_ENV', () => {
    expect(leerConfig(BASE)).toStrictEqual({
      databaseUrl: BASE.DATABASE_URL,
      migracionesDatabaseUrl: BASE.DATABASE_URL,
      port: 3001,
      nodeEnv: 'development',
      origenesPermitidos: [],
    })
    expect(PUERTO_POR_DEFECTO).toBe(3001)
    expect(ENTORNO_POR_DEFECTO).toBe('development')
  })

  it('toma PORT y NODE_ENV del entorno', () => {
    expect(leerConfig({ ...BASE, PORT: '8080', NODE_ENV: 'production' })).toStrictEqual({
      databaseUrl: BASE.DATABASE_URL,
      migracionesDatabaseUrl: BASE.DATABASE_URL,
      port: 8080,
      nodeEnv: 'production',
      origenesPermitidos: [],
    })
  })

  it('las migraciones corren como dueño cuando MIGRATIONS_DATABASE_URL está', () => {
    const config = leerConfig({ ...BASE, MIGRATIONS_DATABASE_URL: URL_DUENIO })

    expect(config.migracionesDatabaseUrl).toBe(URL_DUENIO)
    expect(config.databaseUrl).toBe(BASE.DATABASE_URL)
  })

  it('MIGRATIONS_DATABASE_URL es opcional y vacía cuenta como ausente', () => {
    for (const vacia of ['', '   ']) {
      expect(
        leerConfig({ ...BASE, MIGRATIONS_DATABASE_URL: vacia }),
        `debería caer en DATABASE_URL con MIGRATIONS_DATABASE_URL=${JSON.stringify(vacia)}`,
      ).toStrictEqual({
        databaseUrl: BASE.DATABASE_URL,
        migracionesDatabaseUrl: BASE.DATABASE_URL,
        port: 3001,
        nodeEnv: 'development',
        origenesPermitidos: [],
      })
    }
  })

  it('rechaza un PORT que no es un puerto válido y nombra PORT', () => {
    for (const invalido of ['cero', '0', '65536', '3001.5', '-1']) {
      expect(() => leerConfig({ ...BASE, PORT: invalido }), `debería rechazar PORT=${invalido}`).toThrow(
        /PORT/,
      )
    }
  })

  it('trata un PORT vacío como ausente: el puerto es opcional, la base no', () => {
    expect(leerConfig({ ...BASE, PORT: '' }).port).toBe(PUERTO_POR_DEFECTO)
    expect(leerConfig({ ...BASE, PORT: '   ' }).port).toBe(PUERTO_POR_DEFECTO)
  })

  it('no inventa valores: la configuración leída es la del entorno', () => {
    const config = leerConfig({ ...BASE, PORT: '3001' })
    expect(config.databaseUrl).toBe(BASE.DATABASE_URL)
    expect(config.port).toBe(3001)
    expect(config.nodeEnv).toBe('development')
  })
})

/**
 * CORS es explícito (`docs/specs/0003-api-y-sync.md` §Infraestructura): estos casos fijan la
 * configuración que el servidor aplica, incluido el rechazo del comodín.
 */
describe('leerOrigenesPermitidos', () => {
  it('sin CORS_ORIGINS no hay ningún origen: lista vacía no es "cualquiera"', () => {
    expect(leerOrigenesPermitidos({})).toStrictEqual([])
    expect(leerOrigenesPermitidos({ CORS_ORIGINS: '' })).toStrictEqual([])
    expect(leerOrigenesPermitidos({ CORS_ORIGINS: '   ' })).toStrictEqual([])
  })

  it('toma los orígenes declarados, separados por coma, normalizados y sin repetir', () => {
    const origenes = leerOrigenesPermitidos({
      CORS_ORIGINS:
        ' https://kiosco.altoke.app/ , https://otro.altoke.app,https://kiosco.altoke.app ',
    })

    expect(origenes).toStrictEqual(['https://kiosco.altoke.app', 'https://otro.altoke.app'])
  })

  it('rechaza el comodín `*` en vez de aceptarlo', () => {
    for (const crudo of ['*', 'https://kiosco.altoke.app, *']) {
      expect(
        () => leerOrigenesPermitidos({ CORS_ORIGINS: crudo }),
        `debería rechazar CORS_ORIGINS=${JSON.stringify(crudo)}`,
      ).toThrow(/CORS_ORIGINS/)
    }
  })

  it('rechaza un origen con path, query, credenciales o que no es absoluto', () => {
    for (const crudo of [
      'https://kiosco.altoke.app/pos',
      'https://kiosco.altoke.app?tenant=1',
      'https://usuario:clave@kiosco.altoke.app',
      'kiosco.altoke.app',
      'ftp://kiosco.altoke.app',
    ]) {
      expect(
        () => leerOrigenesPermitidos({ CORS_ORIGINS: crudo }),
        `debería rechazar CORS_ORIGINS=${JSON.stringify(crudo)}`,
      ).toThrow(/inválido/)
    }
  })

  it('acepta http en localhost y exige https fuera de localhost', () => {
    expect(leerOrigenesPermitidos({ CORS_ORIGINS: 'http://localhost:5173' })).toStrictEqual([
      'http://localhost:5173',
    ])
    expect(() => leerOrigenesPermitidos({ CORS_ORIGINS: 'http://kiosco.altoke.app' })).toThrow(
      /https/,
    )
  })

  it('leerConfig expone los orígenes declarados', () => {
    expect(
      leerConfig({ ...BASE, CORS_ORIGINS: 'https://kiosco.altoke.app' }).origenesPermitidos,
    ).toStrictEqual(['https://kiosco.altoke.app'])
  })
})
