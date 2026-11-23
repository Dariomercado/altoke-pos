/**
 * `@altoke/contracts` — el contrato de la red (web ↔ api), en zod.
 *
 * Es **el** validador del cable: los parseos devuelven la forma de error de
 * docs/specs/0003-api-y-sync.md §Errores (`validacion` + `detalle.campo`), así una ruta manda el
 * 400 sin traducir nada y la terminal puede señalar el input que falló.
 *
 * Lo que define el dominio no se redefine acá: `EventoSync` es el `Evento` del libro, validado.
 *
 * Los imports relativos de este paquete llevan la extensión `.ts`: lo consume `apps/api`, que corre
 * sus `.ts` con el type stripping de Node y no resuelve especificadores sin extensión. TypeScript y
 * Vite aceptan las dos formas; Node, sólo la explícita.
 */

export { campoDelCamino } from './errores.ts'
export type {
  Campo,
  CuerpoDeErrorDeValidacion,
  DetalleValidacion,
  ErrorDeValidacion,
  Resultado,
} from './errores.ts'

export { MENSAJE_VALIDACION, parsear } from './parseo.ts'

export { SCHEMA_VERSION_SOPORTADA, esquemaEvento, parsearEvento } from './eventos.ts'
export type { EventoSync } from './eventos.ts'

export {
  parsearSyncEmpujarRespuesta,
  parsearSyncEmpujarSolicitud,
  parsearSyncTraerConsulta,
  parsearSyncTraerRespuesta,
  syncEmpujarRespuesta,
  syncEmpujarSolicitud,
  syncTraerConsulta,
  syncTraerRespuesta,
} from './sync.ts'
export type {
  SyncEmpujarRespuesta,
  SyncEmpujarSolicitud,
  SyncTraerConsulta,
  SyncTraerRespuesta,
} from './sync.ts'
