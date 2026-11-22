import { importeLineaCentavos } from '../pos/venta'
import type { LineaDeVenta, TotalesVenta } from '../pos/venta'
import { formatearCentavos } from '../formato'

export interface PanelVentaProps {
  readonly lineas: readonly LineaDeVenta[]
  readonly totales: TotalesVenta
  readonly efectivoPesos: string
  readonly esTarjeta: boolean
  readonly onCambiarCantidad: (sku: string, delta: number) => void
  readonly onCambiarEfectivo: (pesos: string) => void
  readonly onCambiarTarjeta: (esTarjeta: boolean) => void
  readonly onCobrar: () => void
}

/**
 * Venta en curso: líneas, total y cobro.
 *
 * Ningún total se calcula acá: `calcularTotales` ya lo hizo y este panel sólo lo formatea. La
 * cantidad se cambia de a una unidad porque es lo que hace el cajero con el dedo.
 */
export function PanelVenta({
  lineas,
  totales,
  efectivoPesos,
  esTarjeta,
  onCambiarCantidad,
  onCambiarEfectivo,
  onCambiarTarjeta,
  onCobrar,
}: PanelVentaProps) {
  return (
    <section className="venta" aria-label="Venta en curso">
      <h2 className="venta__titulo">Venta</h2>

      {lineas.length === 0 ? (
        <p className="venta__vacia">Tocá un producto de la izquierda para empezar.</p>
      ) : (
        <ul className="venta__lineas">
          {lineas.map((linea) => (
            <li key={linea.sku} className="linea">
              <span className="linea__nombre">{linea.nombre}</span>
              <span className="linea__importe">
                {formatearCentavos(importeLineaCentavos(linea))}
              </span>
              <span className="linea__acciones">
                <button
                  type="button"
                  className="boton boton--cuadrado"
                  aria-label={`Quitar una unidad de ${linea.nombre}`}
                  onClick={() => onCambiarCantidad(linea.sku, -1)}
                >
                  −
                </button>
                <span className="linea__cantidad">{linea.cantidad}</span>
                <button
                  type="button"
                  className="boton boton--cuadrado"
                  aria-label={`Agregar una unidad de ${linea.nombre}`}
                  onClick={() => onCambiarCantidad(linea.sku, 1)}
                >
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="venta__total">
        <span>Total</span>
        <strong data-testid="total-venta">{formatearCentavos(totales.totalCentavos)}</strong>
      </p>
      <p className="venta__iva">IVA incluido: {formatearCentavos(totales.ivaCentavos)}</p>

      <div className="pagos">
        <label className="campo">
          <span className="campo__etiqueta">Efectivo recibido ($)</span>
          <input
            className="campo__input"
            type="text"
            inputMode="decimal"
            aria-label="Efectivo recibido en pesos"
            value={efectivoPesos}
            disabled={esTarjeta}
            onChange={(evento) => onCambiarEfectivo(evento.target.value)}
          />
        </label>

        <label className="pago-tarjeta">
          <input
            type="checkbox"
            aria-label="Tarjeta (manual)"
            checked={esTarjeta}
            onChange={(evento) => onCambiarTarjeta(evento.target.checked)}
          />
          <span>Tarjeta (manual)</span>
        </label>
      </div>

      <button
        type="button"
        className="boton boton--cobrar"
        disabled={lineas.length === 0}
        onClick={onCobrar}
      >
        Cobrar
      </button>
    </section>
  )
}
