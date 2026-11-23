/**
 * Puerta única de zod hacia el contrato de error del proyecto.
 *
 * Dos decisiones que este archivo hace cumplir para todos los schemas:
 *
 *   - **El primer issue manda.** Una respuesta con la lista completa de campos obliga al cliente a
 *     elegir cuál mostrar; el primer campo que falló alcanza para señalar el input.
 *   - **Los mensajes son del contrato, no de zod.** Todos los campos declaran su mensaje en
 *     castellano (`campos.ts`), así el texto por defecto en inglés de zod nunca llega al cliente.
 */

import type { z } from 'zod'
import { campoDelCamino } from './errores'
import type { CuerpoDeErrorDeValidacion, Resultado } from './errores'

/** Sólo si un schema dejara un issue sin mensaje propio. */
export const MENSAJE_VALIDACION = 'El pedido no es válido.'

export function parsear<S extends z.ZodType>(schema: S, valor: unknown): Resultado<z.infer<S>> {
  const resultado = schema.safeParse(valor)
  if (resultado.success) return { ok: true, dato: resultado.data }

  const primero = resultado.error.issues[0]
  const error: CuerpoDeErrorDeValidacion = {
    error: {
      code: 'validacion',
      mensaje: primero?.message ?? MENSAJE_VALIDACION,
      detalle: { campo: campoDelCamino(primero?.path ?? []) },
    },
  }

  return { ok: false, error }
}
