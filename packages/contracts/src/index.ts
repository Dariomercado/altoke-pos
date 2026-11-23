/**
 * `@altoke/contracts` — el contrato de la red (web ↔ api), en zod.
 *
 * Es **el** validador del cable: los parseos devuelven la forma de error de
 * docs/specs/0003-api-y-sync.md §Errores (`validacion` + `detalle.campo`), así una ruta manda el
 * 400 sin traducir nada y la terminal puede señalar el input que falló.
 *
 * Lo que define el dominio no se redefine acá: `EventoSync` es el `Evento` del libro, validado.
 */

export { campoDelCamino } from './errores'
export type {
  Campo,
  CuerpoDeErrorDeValidacion,
  DetalleValidacion,
  ErrorDeValidacion,
  Resultado,
} from './errores'

export { MENSAJE_VALIDACION, parsear } from './parseo'

export { SCHEMA_VERSION_SOPORTADA, esquemaEvento, parsearEvento } from './eventos'
export type { EventoSync } from './eventos'

export {
  parsearSyncEmpujarRespuesta,
  parsearSyncEmpujarSolicitud,
  parsearSyncTraerConsulta,
  parsearSyncTraerRespuesta,
  syncEmpujarRespuesta,
  syncEmpujarSolicitud,
  syncTraerConsulta,
  syncTraerRespuesta,
} from './sync'
export type {
  SyncEmpujarRespuesta,
  SyncEmpujarSolicitud,
  SyncTraerConsulta,
  SyncTraerRespuesta,
} from './sync'
