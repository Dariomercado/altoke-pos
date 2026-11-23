/**
 * Puerta única del módulo de sesión. Igual que `sync/index.ts`: la app y los tests importan de
 * acá, no de los archivos internos.
 */

export { ACCIONES_DE_POS, ROLES, esRol, puede } from './permisos.ts'
export type { AccionDePos, Rol } from './permisos.ts'

export type {
  DatosDeRegistro,
  Membresia,
  RespuestaSesion,
  RespuestaYo,
  SesionActiva,
  SesionGuardada,
  Tenant,
  Usuario,
} from './tipos.ts'

export {
  ALMACEN_DE_SESION,
  CLAVE_SESION,
  NOMBRE_BASE_DE_SESION,
  crearAlmacenDeSesion,
} from './almacen.ts'
export type { AlmacenDeSesion, OpcionesAlmacenDeSesion } from './almacen.ts'

export {
  MENSAJE_RESPUESTA_INVALIDA,
  MENSAJE_SIN_PERMISO,
  MENSAJE_SIN_RED,
  MENSAJE_SIN_SESION,
  RUTA_REGISTRO,
  RUTA_SESION,
  RUTA_YO,
  baseUrlDesdeEntorno,
  crearClienteDeSesion,
} from './cliente.ts'
export type {
  ClienteDeSesion,
  ErrorDeSesion,
  MotivoDeErrorDeSesion,
  OpcionesClienteDeSesion,
  ResultadoDeSesion,
} from './cliente.ts'

export { crearDependenciasDeSesion } from './dependencias.ts'
export type { DependenciasDeSesion, OpcionesSesionApp } from './dependencias.ts'

export { useSesion } from './useSesion.ts'
export type { AccionesDeSesion, EstadoDeSesion, OpcionesDeSesion } from './useSesion.ts'

export { INTERVALO_DE_SYNC_MS, useSincronizacion } from './useSincronizacion.ts'
export type { OpcionesSincronizacionApp } from './useSincronizacion.ts'
