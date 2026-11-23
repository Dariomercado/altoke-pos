import { scrypt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PARAMETROS_SCRYPT,
  PREFIJO_SCRYPT,
  hashPassword,
  leerRegistroPassword,
  verificarPassword,
  verificarPasswordSenuelo,
} from './password.ts'

const PASSWORD = 'una-contraseña-de-verdad'

const sal = (partes: readonly string[]): string => partes[4] ?? ''
const clave = (partes: readonly string[]): string => partes[5] ?? ''

describe('hashPassword', () => {
  it('guarda un registro autodescriptivo: scrypt$N$r$p$sal$hash', async () => {
    const registro = await hashPassword(PASSWORD)
    const partes = registro.split('$')

    expect(partes).toHaveLength(6)
    expect(partes[0]).toBe(PREFIJO_SCRYPT)
    expect(partes[1]).toBe(String(2 ** 14))
    expect(partes[2]).toBe('8')
    expect(partes[3]).toBe('1')
    expect(Buffer.from(partes[4] ?? '', 'base64')).toHaveLength(16)
    expect(Buffer.from(partes[5] ?? '', 'base64')).toHaveLength(64)
  })

  it('nunca guarda la contraseña en claro', async () => {
    const registro = await hashPassword(PASSWORD)
    expect(registro).not.toContain(PASSWORD)
  })

  it('usa una sal nueva por hash: el mismo password da registros distintos y los dos verifican', async () => {
    const uno = await hashPassword(PASSWORD)
    const otro = await hashPassword(PASSWORD)

    expect(uno).not.toBe(otro)
    await expect(verificarPassword(PASSWORD, uno)).resolves.toBe(true)
    await expect(verificarPassword(PASSWORD, otro)).resolves.toBe(true)
  })
})

describe('verificarPassword', () => {
  it('acepta el password correcto y rechaza el incorrecto', async () => {
    const registro = await hashPassword(PASSWORD)

    await expect(verificarPassword(PASSWORD, registro)).resolves.toBe(true)
    await expect(verificarPassword(PASSWORD.toUpperCase(), registro)).resolves.toBe(false)
    await expect(verificarPassword('', registro)).resolves.toBe(false)
  })

  it('deriva con los parámetros y el largo guardados, no con las constantes del día', async () => {
    // Un registro "futuro": otros parámetros y otro largo de hash. Si verificar usara las
    // constantes actuales, esto daría false y subir los parámetros obligaría a reescribir la tabla.
    const sal = Buffer.alloc(16, 7)
    const clave = await new Promise<Buffer>((resolver, rechazar) => {
      scrypt(
        PASSWORD,
        sal,
        32,
        { N: 2 ** 15, r: 4, p: 1, maxmem: 128 * 1024 * 1024 },
        (error, derivada) => (error ? rechazar(error) : resolver(derivada)),
      )
    })
    const registro = ['scrypt', 2 ** 15, 4, 1, sal.toString('base64'), clave.toString('base64')].join('$')

    expect(leerRegistroPassword(registro)?.parametros).toStrictEqual({ N: 2 ** 15, r: 4, p: 1 })
    await expect(verificarPassword(PASSWORD, registro)).resolves.toBe(true)
    await expect(verificarPassword(`${PASSWORD}!`, registro)).resolves.toBe(false)
  })

  it('un registro corrupto o manipulado da false, nunca una excepción que se vuelva 500', async () => {
    const valido = await hashPassword(PASSWORD)
    const partes = valido.split('$')
    const corruptos = [
      '',
      'texto-plano',
      valido.replace('scrypt', 'argon2'),
      [partes[0], 'no-es-un-numero', ...partes.slice(2)].join('$'),
      // N que no es potencia de dos: scrypt no lo acepta y el registro no es válido.
      [partes[0], '1000', ...partes.slice(2)].join('$'),
      // N=1 es potencia de dos pero scrypt no lo acepta.
      [partes[0], '1', ...partes.slice(2)].join('$'),
      // Parámetros absurdos: no pueden convertir un login en una excepción (ni en minutos de CPU).
      [partes[0], String(2 ** 20), '32', '16', sal(partes), clave(partes)].join('$'),
      // Sin sal ni hash.
      [partes[0], partes[1], partes[2], partes[3], '', ''].join('$'),
    ]

    for (const registro of corruptos) {
      await expect(
        verificarPassword(PASSWORD, registro),
        `debería rechazar ${JSON.stringify(registro)}`,
      ).resolves.toBe(false)
    }
  })
})

describe('verificarPasswordSenuelo', () => {
  it('cuesta lo mismo que un login real: el tiempo no dice si el email existe', async () => {
    const real = await hashPassword(PASSWORD)
    const antesReal = performance.now()
    await verificarPassword(PASSWORD, real)
    const costoReal = performance.now() - antesReal

    const antesSenuelo = performance.now()
    await verificarPasswordSenuelo(PASSWORD)
    const costoSenuelo = performance.now() - antesSenuelo

    // scrypt con N=2^14 no baja de unos milisegundos en ninguna máquina razonable: el piso
    // detecta el error de "olvidarse de hashear" sin medir diferencias finas.
    expect(costoSenuelo).toBeGreaterThan(1)
    expect(costoSenuelo).toBeLessThan(costoReal * 10 + 50)
  })

  it('no deja pasar la contraseña del señuelo ni revienta con cualquier entrada', async () => {
    await expect(verificarPasswordSenuelo('')).resolves.toBeUndefined()
    await expect(verificarPasswordSenuelo('senuelo-de-altoke: ninguna contraseña real llega acá')).resolves.toBeUndefined()
  })
})

describe('parámetros', () => {
  it('son los del spec: N=2^14, r=8, p=1, sal de 16 bytes', () => {
    expect(PARAMETROS_SCRYPT).toStrictEqual({
      N: 16_384,
      r: 8,
      p: 1,
      longitudSal: 16,
      longitudHash: 64,
    })
  })
})
