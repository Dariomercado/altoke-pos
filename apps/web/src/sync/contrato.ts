/**
 * Punto único por el que la web importa `@altoke/contracts`.
 *
 * La dependencia está declarada en `apps/web/package.json` como `workspace:*`, igual que
 * `@altoke/domain`, `@altoke/store` y `@altoke/ui`: el POS valida el cable con el **mismo** código
 * que el servidor, no con una copia de las formas de `0003` §Sync.
 *
 * Se centraliza en un archivo para que T10 (pantallas de sesión) tenga una sola importación que
 * seguir y para que el resto del módulo de sync no dependa del nombre del paquete.
 */

export {
  parsearSyncEmpujarRespuesta,
  parsearSyncTraerRespuesta,
} from '@altoke/contracts'
export type {
  SyncEmpujarRespuesta,
  SyncEmpujarSolicitud,
  SyncTraerConsulta,
  SyncTraerRespuesta,
} from '@altoke/contracts'
