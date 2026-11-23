/**
 * Formato de plata y de fechas del POS.
 *
 * Todo lo que el cajero lee como número pasa por acá: los componentes no concatenan signos ni
 * separadores a mano. La plata se guarda en centavos enteros (invariante I3) y sólo se convierte a
 * pesos en el borde de la pantalla, en dos direcciones:
 *
 *   - `formatearCentavos` para mostrar (incluye signo: un arqueo puede dar faltante).
 *   - `pesosDesdeCentavos` / `centavosDesdePesos` para los `<input>` en pesos del cobro y del
 *     cierre.
 *
 * La fecha del ticket se formatea en hora argentina y no en la del dispositivo: dos terminales en
 * husos distintos tienen que imprimir la misma hora para la misma venta.
 */

const FORMATO_MONEDA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

/** Monto en pesos con dos decimales. Acepta negativos: la diferencia de un arqueo los usa. */
export function formatearCentavos(centavos: number): string {
  return FORMATO_MONEDA.format(centavos / 100)
}

/** Valor para un `<input>` en pesos: sin símbolo y con coma decimal. */
export function pesosDesdeCentavos(centavos: number): string {
  return (centavos / 100).toFixed(2).replace('.', ',')
}

/**
 * Lee el input del cajero en pesos y devuelve centavos enteros.
 *
 * `null` —y no cero— cuando el texto no es un monto: cero es un pago válido del cajero y
 * confundirlos dejaría cobrar una venta con un dedazo.
 */
export function centavosDesdePesos(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')

  if (!/^\d+(\.\d{0,2})?$/.test(limpio)) return null

  const [enteros = '0', decimales = ''] = limpio.split('.')
  const centavos = Number(enteros) * 100 + Number(decimales.padEnd(2, '0'))

  return Number.isSafeInteger(centavos) ? centavos : null
}

/** Fecha y hora del ticket, en hora argentina. */
export function formatearFechaHora(iso: string): string {
  const fecha = new Date(iso)

  return Number.isNaN(fecha.getTime()) ? iso : FORMATO_FECHA_HORA.format(fecha)
}
