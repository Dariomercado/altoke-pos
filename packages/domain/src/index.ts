// Dominio puro de AlToke (invariante I1): sin IO, sin React, sin otros paquetes del workspace.
export {
  ALICUOTAS_IVA,
  desglosarIva,
  esCentavos,
  importeConIva,
  redondearMitadArriba,
} from './dinero'
export type { AlicuotaBps, Centavos } from './dinero'

export {
  MEDIOS_PAGO,
  leerDesde,
  proyeccionStock,
  proyeccionTurno,
  proyectar,
  resumirTurno,
  validarEvento,
} from './eventos'
export type {
  EstadoTurno,
  EstadoVenta,
  Evento,
  MedioPago,
  PagoRegistrado,
  Proyeccion,
  ResumenTurno,
  StockPorSku,
  VentaEnTurno,
} from './eventos'
