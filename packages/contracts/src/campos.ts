/**
 * Campos compartidos por los schemas del contrato, con los mensajes del proyecto.
 *
 * Las reglas son **al menos tan estrictas como las de `validarEvento` del dominio** (el servidor no
 * puede aceptar algo que la terminal rechaza), y los mensajes nombran el campo: el camino
 * (`eventos.0.secuencia`) lo arma `errores.ts`, el mensaje no lo repite.
 */

import { z } from 'zod'

/** Texto no vacío, igual que `exigirTexto` del dominio: un espacio no es un valor. */
export function texto(campo: string): z.ZodString {
  const mensaje = `${campo} debe ser un texto no vacío.`
  return z
    .string({ error: mensaje })
    .refine((valor) => valor.trim() !== '', { error: mensaje })
}

export function entero(campo: string): z.ZodNumber {
  const mensaje = `${campo} debe ser un entero.`
  return z.number({ error: mensaje }).int({ error: mensaje })
}

export function enteroPositivo(campo: string): z.ZodNumber {
  return entero(campo).positive({ error: `${campo} debe ser un entero positivo.` })
}

/** Un acuse en cero es válido: una terminal que todavía no recibió nada. */
export function enteroNoNegativo(campo: string): z.ZodNumber {
  return entero(campo).min(0, { error: `${campo} debe ser un entero no negativo.` })
}

/**
 * Centavos: entero no negativo y seguro (invariante I3: el dinero se calcula en centavos enteros,
 * nunca en floats). `Number.MAX_SAFE_INTEGER` deja afuera el número que ya perdió precisión.
 */
export function centavos(campo: string): z.ZodNumber {
  const mensaje = `${campo} debe ser centavos enteros no negativos.`
  return entero(campo)
    .min(0, { error: mensaje })
    .max(Number.MAX_SAFE_INTEGER, { error: mensaje })
}
