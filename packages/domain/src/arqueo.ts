/**
 * Arqueo de caja por denominación (S4: kioscos de barrio, donde el cierre de turno se cuenta
 * billete por billete, no se lee de una pantalla).
 *
 * La regla que hace útil un arqueo: **lo esperado sale del libro, no de la memoria del cajero**.
 * Por eso `arqueoDesdeTurno` toma el `ResumenTurno` ya proyectado y suma fondo + efectivo. Lo
 * cobrado por QR o transferencia no está en el cajón y contarlo como esperado produce un sobrante
 * fantasma en cada cierre.
 *
 * El conteo se valida contra la tabla de denominaciones: una clave que no existe (un typo, o un
 * importe en pesos en vez de centavos) es plata inventada, y es más barato rechazarla que explicar
 * después por qué el turno cerró con 100.000 de sobrante.
 */

import { esCentavos } from './dinero.ts'
import type { Centavos } from './dinero.ts'
import type { ResumenTurno } from './eventos.ts'

/**
 * Denominaciones en circulación, en centavos y de mayor a menor.
 *
 * Billetes: 10.000, 5.000, 2.000, 1.000, 500, 200, 100, 50, 20 y 10 pesos. Monedas: 10, 5, 2 y 1
 * peso y las fracciones que todavía circulan. El billete y la moneda de 10 pesos valen lo mismo y
 * se cuentan juntos: para el arqueo importa el valor, no el material.
 */
export const DENOMINACIONES: readonly Centavos[] = Object.freeze([
  1_000_000,
  500_000,
  200_000,
  100_000,
  50_000,
  20_000,
  10_000,
  5_000,
  2_000,
  1_000,
  500,
  200,
  100,
  50,
  25,
  10,
  5,
  1,
])

/** Cuántas unidades de cada denominación contó el cajero. La clave es el valor en centavos. */
export type ConteoPorDenominacion = Readonly<Record<number, number>>

export type EstadoArqueo = 'cuadrado' | 'faltante' | 'sobrante'

export interface Arqueo {
  readonly esperadoCentavos: Centavos
  readonly contadoCentavos: Centavos
  /** `contado − esperado`: negativo es faltante, positivo sobrante. */
  readonly diferenciaCentavos: number
  readonly estado: EstadoArqueo
}

function validarConteo(conteo: ConteoPorDenominacion): void {
  for (const [clave, cantidad] of Object.entries(conteo)) {
    const valorCentavos = Number(clave)

    if (!DENOMINACIONES.includes(valorCentavos)) {
      throw new RangeError(`Denominación desconocida: ${clave} (se espera un valor en centavos)`)
    }
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0) {
      throw new RangeError(`Cantidad inválida para ${clave}: ${String(cantidad)}`)
    }
  }
}

/** Total contado en el cajón, en centavos. */
export function contarDenominaciones(conteo: ConteoPorDenominacion): Centavos {
  validarConteo(conteo)

  let totalCentavos = 0

  for (const [clave, cantidad] of Object.entries(conteo)) {
    totalCentavos += Number(clave) * cantidad
  }

  return totalCentavos
}

export function armarArqueo(entrada: {
  readonly esperadoCentavos: Centavos
  readonly contadoCentavos: Centavos
}): Arqueo {
  if (!esCentavos(entrada.esperadoCentavos)) {
    throw new RangeError(`Esperado inválido: ${entrada.esperadoCentavos}`)
  }
  if (!esCentavos(entrada.contadoCentavos)) {
    throw new RangeError(`Contado inválido: ${entrada.contadoCentavos}`)
  }

  const diferenciaCentavos = entrada.contadoCentavos - entrada.esperadoCentavos
  const estado: EstadoArqueo =
    diferenciaCentavos === 0 ? 'cuadrado' : diferenciaCentavos < 0 ? 'faltante' : 'sobrante'

  return {
    esperadoCentavos: entrada.esperadoCentavos,
    contadoCentavos: entrada.contadoCentavos,
    diferenciaCentavos,
    estado,
  }
}

/**
 * Arqueo del turno: fondo inicial más lo cobrado en efectivo, contra lo que hay en el cajón.
 *
 * Los otros medios no entran al cajón y quedan fuera del esperado a propósito.
 */
export function arqueoDesdeTurno(
  resumen: ResumenTurno,
  conteo: ConteoPorDenominacion,
): Arqueo {
  return armarArqueo({
    esperadoCentavos: resumen.fondoCentavos + resumen.cobradoPorMedio.efectivo,
    contadoCentavos: contarDenominaciones(conteo),
  })
}
