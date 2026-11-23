// Dominio puro de AlToke (invariante I1): sin IO, sin React, sin otros paquetes del workspace.
// Los imports relativos llevan la extensión `.ts`: además de `apps/web` (Vite) lo consume
// `apps/api`, que corre sus `.ts` con el type stripping de Node y no resuelve sin extensión.
export {
  ALICUOTAS_IVA,
  desglosarIva,
  esCentavos,
  importeConIva,
  redondearMitadArriba,
} from './dinero.ts'
export type { AlicuotaBps, Centavos } from './dinero.ts'

export {
  MEDIOS_PAGO,
  SCHEMA_VERSION_ACTUAL,
  TERMINAL_DEL_SERVIDOR,
  TIPOS_DEL_SERVIDOR,
  esTipoDelServidor,
  leerDesde,
  proyeccionSobreventas,
  proyeccionStock,
  proyeccionTurno,
  proyectar,
  resumirTurno,
  validarEvento,
  validarEventoDeCliente,
} from './eventos.ts'
export type {
  EstadoTurno,
  EstadoVenta,
  Evento,
  MedioPago,
  PagoRegistrado,
  Proyeccion,
  ResumenTurno,
  Sobreventa,
  SobreventasPorVenta,
  StockPorSku,
  TipoDelServidor,
  VentaEnTurno,
} from './eventos.ts'

export {
  DENOMINACIONES,
  armarArqueo,
  arqueoDesdeTurno,
  contarDenominaciones,
} from './arqueo.ts'
export type { Arqueo, ConteoPorDenominacion, EstadoArqueo } from './arqueo.ts'

export {
  CADENA_DE_MIGRACIONES,
  MigracionAusente,
  VersionDeSchemaFutura,
  migrarEvento,
} from './migraciones.ts'
export type { CadenaDeMigraciones, CuerpoDeEvento, PasoDeMigracion } from './migraciones.ts'
