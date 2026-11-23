/**
 * Aritmética de dinero del dominio (invariante I3 de docs/specs/0001-arquitectura.md).
 *
 * Reglas, todas verificadas por `dinero.test.ts`:
 *   - La unidad es el **centavo**, `number` entero. Nunca floats en el camino crítico.
 *   - Se redondea **half-up al centavo**, simétrico en signo: el medio se aleja de cero.
 *   - El precio de góndola **ya incluye IVA**: el neto se obtiene invirtiendo la alícuota,
 *     no sumándola. Sumarla es el bug que deja los márgenes 21% arriba sin que nadie lo note.
 *
 * Las alícuotas se expresan en **puntos básicos** (2100 = 21%) para no multiplicar por
 * fracciones: 21% no es representable como float y `0.21` ya arrastra error.
 */

/** Importe en centavos: entero y no negativo. */
export type Centavos = number

/** Alícuota de IVA en puntos básicos: 2100 = 21%. */
export type AlicuotaBps = number

const BPS_TOTAL = 10_000

/** Alícuotas vigentes en Argentina. Monotributo emite sin discriminar IVA (alícuota cero). */
export const ALICUOTAS_IVA = {
  cero: 0,
  reducida: 1050,
  general: 2100,
  diferencial: 2700,
} as const

/** Valida lo que entra desde el borde (formularios, IndexedDB) antes de calcular. */
export function esCentavos(valor: unknown): valor is Centavos {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && Number.isSafeInteger(valor)
}

function validarAlicuota(alicuotaBps: number): void {
  if (!Number.isInteger(alicuotaBps) || alicuotaBps < 0 || alicuotaBps > BPS_TOTAL) {
    throw new RangeError(`Alícuota inválida: ${alicuotaBps} bps (esperado entero entre 0 y 10000)`)
  }
}

/**
 * División entera con redondeo half-up.
 *
 * `numerador / denominador` se resuelve sin coma flotante: se duplica para comparar contra
 * el medio exacto. El signo se aplica al final, así el medio siempre se aleja de cero
 * (sirve igual para descuentos y notas de crédito).
 */
export function redondearMitadArriba(numerador: number, denominador: number): number {
  if (!Number.isInteger(numerador)) {
    throw new RangeError(`Numerador no entero: ${numerador}`)
  }
  if (!Number.isInteger(denominador) || denominador <= 0) {
    throw new RangeError(`Denominador inválido: ${denominador} (esperado entero positivo)`)
  }

  const signo = numerador < 0 ? -1 : 1
  const absoluto = Math.abs(numerador)

  return signo * Math.floor((2 * absoluto + denominador) / (2 * denominador))
}

/**
 * Desglosa un importe que ya incluye IVA: devuelve neto e IVA, sin perder ni un centavo.
 *
 * `iva = round(total × alícuota / (10000 + alícuota))`, porque el total es la base más el
 * impuesto: el IVA contenido es a / (1 + a) del total, no a del total.
 */
export function desglosarIva(
  totalCentavos: Centavos,
  alicuotaBps: AlicuotaBps,
): { netoCentavos: Centavos; ivaCentavos: Centavos } {
  if (!esCentavos(totalCentavos)) {
    throw new RangeError(`Total inválido: ${totalCentavos} (debe ser centavos enteros no negativos)`)
  }
  validarAlicuota(alicuotaBps)

  const ivaCentavos = redondearMitadArriba(totalCentavos * alicuotaBps, BPS_TOTAL + alicuotaBps)

  return { netoCentavos: totalCentavos - ivaCentavos, ivaCentavos }
}

/**
 * Importe final que paga el cliente: neto más alícuota, redondeado al centavo.
 *
 * Es el camino inverso a `desglosarIva` y lo usa el inventario para poner precio de góndola
 * a partir del costo y el margen.
 */
export function importeConIva(netoCentavos: Centavos, alicuotaBps: AlicuotaBps): Centavos {
  if (!esCentavos(netoCentavos)) {
    throw new RangeError(`Neto inválido: ${netoCentavos} (debe ser centavos enteros no negativos)`)
  }
  validarAlicuota(alicuotaBps)

  return netoCentavos + redondearMitadArriba(netoCentavos * alicuotaBps, BPS_TOTAL)
}
