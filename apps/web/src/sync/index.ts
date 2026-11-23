/**
 * El sync de la terminal, como módulo (T9 de odd/tasks/altoke-m2-sync.md).
 *
 * Una sola puerta para T10: el transporte (`fetch` en la app, un doble en tests), la cola derivada
 * del libro, el acuse persistido, el sincronizador con backoff y la purga del tenant al cerrar
 * sesión. Nada de acá toca `window` al importarse: la fábrica de IndexedDB y el `fetch` se inyectan.
 */

export {
  ALMACEN_DE_ACUSES,
  PREFIJO_BASE_DEL_TENANT,
  PREFIJO_BASE_DE_ACUSES,
  basesDelTenant,
  crearAlmacenDeAcuses,
  nombreDeBaseDeAcuses,
  nombreDeBaseDelTenant,
  purgarTenantLocal,
} from './almacen-local.ts'
export type {
  AlmacenDeAcuses,
  OpcionesAlmacenDeAcuses,
  OpcionesPurga,
} from './almacen-local.ts'

export { colaDeSync, pendientesDe, validarSecuenciaAcusada } from './cola.ts'

export {
  MENSAJE_RESPUESTA_INVALIDA,
  MENSAJE_SIN_PERMISO,
  MENSAJE_SIN_RED,
  MENSAJE_SIN_SESION,
  MENSAJE_VALIDACION,
  crearTransporteFetch,
} from './transporte.ts'
export type {
  ErrorDeTransporte,
  MotivoDeFallo,
  OpcionesTransporteFetch,
  RespuestaDeEmpuje,
  ResultadoDeRed,
  TransporteDeSync,
} from './transporte.ts'

export { DESDE_EL_PRINCIPIO, crearSincronizador } from './sincronizador.ts'
export type {
  EstadoSync,
  InstantaneaSync,
  OpcionesSincronizador,
  SesionDeSync,
  Sincronizador,
} from './sincronizador.ts'
