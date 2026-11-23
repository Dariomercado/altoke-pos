/**
 * Vocabulario de error de docs/specs/0003-api-y-sync.md §Errores, en el borde de validación.
 *
 * La forma única es `{ error: { code, mensaje, detalle? } }`. zod devuelve un `ZodError` con issues
 * en otra forma y en otro idioma; si eso llegara a la ruta, cada handler tendría que traducirlo y el
 * contrato dejaría de ser el contrato. Por eso el parseo de este paquete devuelve directamente el
 * cuerpo del 400: la ruta hace `reply.status(400).send(resultado.error)` y no traduce nada.
 *
 * `detalle.campo` es el camino de campos con puntos (`email`, `tenant.slug`, `eventos.0.tipo`): el
 * cliente señala el input que falló sin adivinar y sin tener que parsear un mensaje.
 */

/** El camino que nombra un error de validación. */
export type Campo = string

export interface DetalleValidacion {
  readonly campo: Campo
}

export interface ErrorDeValidacion {
  readonly code: 'validacion'
  readonly mensaje: string
  readonly detalle: DetalleValidacion
}

/** El cuerpo del 400 tal como lo define 0003 §Errores. */
export interface CuerpoDeErrorDeValidacion {
  readonly error: ErrorDeValidacion
}

/** Parseo como valor: nada de excepciones en el borde de la red. */
export type Resultado<T> =
  | { readonly ok: true; readonly dato: T }
  | { readonly ok: false; readonly error: CuerpoDeErrorDeValidacion }

/**
 * Sin camino no hay campo que señalar (el valor no era ni un objeto): el campo es el cuerpo entero.
 * Los índices de array son un segmento más, así `eventos[0].tipo` se lee `eventos.0.tipo`.
 */
export function campoDelCamino(camino: readonly PropertyKey[]): Campo {
  return camino.length === 0 ? 'cuerpo' : camino.map(String).join('.')
}
