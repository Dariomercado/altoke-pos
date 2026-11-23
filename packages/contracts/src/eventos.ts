/**
 * El `Evento` del libro en el borde de la red (docs/specs/0001-arquitectura.md §2 y
 * docs/specs/0003-api-y-sync.md §Sync).
 *
 * La forma **no se define acá: se importa del dominio** y el schema sólo la valida. Si el contrato
 * inventara su propia forma, la terminal y el servidor podrían estar de acuerdo entre ellos y en
 * desacuerdo con el libro, que es el peor de los mundos posibles: los eventos entrarían al libro
 * local sin pasar por `validarEvento`.
 *
 * Qué rechaza, y por qué cada uno rompe algo si pasa:
 *   - Un **`tipo`** que el dominio no conoce: el servidor no puede proyectar lo que no entiende.
 *   - **`secuencia`** que no es un entero positivo: es el orden del libro y la clave de idempotencia.
 *   - **`schemaVersion`** que no es un entero positivo, o mayor a la que este código sabe leer:
 *     aceptarla en silencio sería aplicar un cuerpo con las reglas de otra versión (§schemaVersion).
 *   - Un **envoltorio** sin `tenantId`, `terminalId` u `ocurridoEn`: sin ellos el evento no
 *     pertenece a ninguna terminal ni tiene lugar en el tiempo.
 *
 * `sobreventa_detectada` **no está**: el evento todavía no existe en la unión del dominio (lo agrega
 * T6, odd/tasks/altoke-m2-sync.md). Un tipo que el libro no tiene no se inventa en el contrato.
 */

import { z } from 'zod'
import { MEDIOS_PAGO } from '@altoke/domain'
import { centavos, entero, enteroPositivo, texto } from './campos'
import { parsear } from './parseo'
import type { Resultado } from './errores'

/** La versión de schema que este código sabe leer: en M2 sólo existe v1 (0003 §schemaVersion). */
export const SCHEMA_VERSION_SOPORTADA = 1

/**
 * Versión declarada por el evento.
 *
 * Positiva e igual o menor a la soportada, nunca "la que venga": la cadena de migraciones
 * (`vN → vN+1`) es lo que permite leer una versión vieja, y migrar una versión **futura** no está
 * definido. El `pipe` final es la prueba de tipos de lo que el `refine` ya garantiza en runtime:
 * después del filtro, la única versión posible es la soportada.
 */
const esquemaSchemaVersion = enteroPositivo('schemaVersion')
  .refine((version) => version <= SCHEMA_VERSION_SOPORTADA, {
    error: `schemaVersion no soportada: esta versión del código entiende hasta v${SCHEMA_VERSION_SOPORTADA}.`,
  })
  .pipe(z.literal(SCHEMA_VERSION_SOPORTADA))

/** Lo que todo evento lleva, sin importar su tipo. */
const ENVOLTORIO = {
  /** Opaco para el dominio: sólo tiene que ser único y no vacío. */
  id: texto('id'),
  tenantId: texto('tenantId'),
  terminalId: texto('terminalId'),
  secuencia: enteroPositivo('secuencia'),
  ocurridoEn: z.iso.datetime({ error: 'ocurridoEn debe ser una fecha ISO-8601.' }),
  schemaVersion: esquemaSchemaVersion,
}

/** Un mensaje que nombra el tipo que llegó, en vez de la lista de los que zod esperaba. */
function tipoDesconocido(issue: { readonly input?: unknown }): string {
  const tipo = (issue.input as { readonly tipo?: unknown } | undefined)?.tipo
  return `Tipo de evento desconocido: ${String(tipo)}`
}

/**
 * La unión del dominio, tipo por tipo. Los cuatro campos propios de cada evento son los mismos
 * (y con las mismas reglas) que exige `validarEvento`: el servidor no puede aceptar algo que la
 * terminal rechazaría, ni al revés.
 */
export const esquemaEvento = z.discriminatedUnion(
  'tipo',
  [
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('turno_abierto'),
      turnoId: texto('turnoId'),
      fondoCentavos: centavos('fondoCentavos'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('venta_iniciada'),
      ventaId: texto('ventaId'),
      turnoId: texto('turnoId'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('item_agregado'),
      ventaId: texto('ventaId'),
      sku: texto('sku'),
      cantidad: enteroPositivo('cantidad'),
      precioUnitarioCentavos: centavos('precioUnitarioCentavos'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('item_quitado'),
      ventaId: texto('ventaId'),
      sku: texto('sku'),
      cantidad: enteroPositivo('cantidad'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('item_devuelto'),
      ventaId: texto('ventaId'),
      sku: texto('sku'),
      cantidad: enteroPositivo('cantidad'),
      motivo: texto('motivo'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('descuento'),
      ventaId: texto('ventaId'),
      montoCentavos: centavos('montoCentavos'),
      motivo: texto('motivo'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('pago_registrado'),
      ventaId: texto('ventaId'),
      medio: z.enum(MEDIOS_PAGO, {
        error: `medio debe ser uno de: ${MEDIOS_PAGO.join(', ')}.`,
      }),
      montoCentavos: centavos('montoCentavos'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('venta_confirmada'),
      ventaId: texto('ventaId'),
      totalCentavos: centavos('totalCentavos'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('venta_anulada'),
      ventaId: texto('ventaId'),
      motivo: texto('motivo'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('ajuste_stock'),
      sku: texto('sku'),
      // Puede ser negativo (merma, corrección) pero nunca fraccionario: el stock es de unidades.
      delta: entero('delta'),
      causa: texto('causa'),
    }),
    z.object({
      ...ENVOLTORIO,
      tipo: z.literal('turno_cerrado'),
      turnoId: texto('turnoId'),
      declaradoCentavos: centavos('declaradoCentavos'),
    }),
  ],
  { error: tipoDesconocido },
)

/**
 * El evento tal como lo devuelve el parseo: la misma forma que `Evento` del dominio.
 *
 * No se deriva de `Evento` por decreto: `eventos.test.ts` comprueba en los dos sentidos que la
 * forma coincide (el dominio entra, y lo parseado se asigna a `Evento[]` sin castear). Si la unión
 * del dominio cambia y el schema no, el typecheck del test falla antes que cualquier runtime.
 */
export type EventoSync = z.infer<typeof esquemaEvento>

export function parsearEvento(valor: unknown): Resultado<EventoSync> {
  return parsear(esquemaEvento, valor)
}
