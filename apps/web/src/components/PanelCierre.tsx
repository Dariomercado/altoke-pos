import { useState } from 'react'
import { Check, Eraser } from 'lucide-react'
import type { Arqueo, Centavos, ConteoPorDenominacion, ResumenTurno } from '@altoke/domain'
import { formatearCentavos } from '../formato'
import { FilaDenominacion } from './bandeja/FilaDenominacion'
import type { TipoDeDenominacion } from './bandeja/FilaDenominacion'
import { ResumenDelTurno } from './bandeja/ResumenDelTurno'
import { VeredictoArqueo } from './bandeja/VeredictoArqueo'
import { Button } from './ui/button'

/**
 * Corte entre billetes y monedas, en centavos.
 *
 * El dominio cuenta **por valor** y no por material (el billete y la moneda de $10 se suman en la
 * misma clave de `ConteoPorDenominacion`), así que la pantalla no puede tener dos filas de $10:
 * los dos grupos se reparten las denominaciones y el corte cae en $10, que queda del lado de los
 * billetes porque es el mayor de los dos.
 */
const BILLETE_MINIMO_CENTAVOS = 1_000

export interface PanelCierreProps {
  readonly denominaciones: readonly Centavos[]
  readonly conteo: ConteoPorDenominacion
  readonly arqueo: Arqueo
  readonly turno: ResumenTurno
  /** Error de la última acción de la caja: la capa del cierre tapa el aviso de la pantalla de venta. */
  readonly error: string | null
  readonly onCambiarCantidad: (denominacion: Centavos, cantidad: number) => void
  readonly onVaciar: () => void
  readonly onConfirmar: () => void | Promise<void>
  readonly onCancelar: () => void
}

/**
 * Cierre de caja de la bandeja táctil (T7): el arqueo por denominación a la izquierda, el veredicto
 * y las acciones a la derecha, al alcance del pulgar.
 *
 * Ocupa la pantalla entera (`fixed inset-0`) porque contar billete por billete es una tarea, no un
 * panel al costado de la venta: así entra en 1280×800 sin que la bandeja de venta le robe altura y
 * el botón de confirmar queda siempre visible — la columna de la derecha es un `grid` con el
 * veredicto y las acciones anclados abajo, y lo que scrollea son las cifras y las denominaciones.
 *
 * No calcula plata: `arqueo` llega armado por `armarArqueo` y el cierre lo escribe la caja. Acá sólo
 * se decide qué se puede tocar: con el conteo en cero y un esperado mayor que cero no se confirma
 * de un toque —un turno entero declarado como faltante por no haber contado es el error caro—, y
 * para eso está la marca explícita «El cajón está vacío».
 */
export function PanelCierre({
  denominaciones,
  conteo,
  arqueo,
  turno,
  error,
  onCambiarCantidad,
  onVaciar,
  onConfirmar,
  onCancelar,
}: PanelCierreProps) {
  const [enviando, setEnviando] = useState(false)
  const [cajonVacioDeclarado, setCajonVacioDeclarado] = useState(false)

  const unidades = Object.values(conteo).reduce((suma, cantidad) => suma + cantidad, 0)
  const cajonSinCargar = unidades === 0 && arqueo.esperadoCentavos > 0
  const bloqueado = cajonSinCargar && !cajonVacioDeclarado
  const puedeConfirmar = !enviando && !bloqueado

  const billetes = denominaciones.filter((denominacion) => denominacion >= BILLETE_MINIMO_CENTAVOS)
  const monedas = denominaciones.filter((denominacion) => denominacion < BILLETE_MINIMO_CENTAVOS)

  const motivo = enviando
    ? 'Cerrando el turno…'
    : bloqueado
      ? 'Todavía no cargaste ninguna unidad: el cajón figura en $ 0,00. Si está vacío de verdad, marcalo para poder cerrar.'
      : null

  async function confirmar(): Promise<void> {
    if (!puedeConfirmar) return

    // El cierre es un evento: dos toques seguidos escribirían un turno cerrado sobre otro. Si la
    // caja lo rechaza, el botón vuelve a habilitarse y el motivo se lee acá adentro.
    setEnviando(true)

    try {
      await onConfirmar()
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section
      aria-label="Cerrar caja"
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-muted text-foreground"
    >
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-[var(--space-lg)] border-b border-border bg-card px-[var(--page-margin-desktop)] py-[var(--space-md)]">
        <div>
          <p className="text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
            Cierre de turno
          </p>
          <h2 className="font-sans text-[1.75rem] font-bold leading-9 tracking-[-0.02em]">
            Cerrar caja
          </h2>
          <p className="mt-[var(--space-xs)] text-xs leading-4 text-muted-foreground">
            Contá el efectivo del cajón. El sistema lo compara contra lo que debería haber.
          </p>
        </div>

        <p className="text-right">
          <span className="block text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
            Efectivo contado
          </span>
          <b className="block font-sans text-[1.75rem] font-bold leading-9 tabular-nums">
            {formatearCentavos(arqueo.contadoCentavos)}
          </b>
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-[var(--space-lg)] overflow-y-auto px-[var(--page-margin-desktop)] py-[var(--space-md)] lg:grid-cols-[minmax(0,1fr)_25rem] lg:overflow-hidden">
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
          <div className="min-h-0 overflow-y-auto pr-[var(--space-xs)]">
            <Grupo
              titulo="Billetes"
              tipo="billete"
              denominaciones={billetes}
              conteo={conteo}
              onCambiarCantidad={onCambiarCantidad}
            />
            <Grupo
              titulo="Monedas"
              tipo="moneda"
              denominaciones={monedas}
              conteo={conteo}
              onCambiarCantidad={onCambiarCantidad}
            />
          </div>

          <div className="flex flex-wrap items-center gap-[var(--space-md)] border-t border-border pt-[var(--space-sm)]">
            <p className="text-xs leading-4 text-muted-foreground">
              {unidades === 0
                ? 'Sin unidades cargadas: el contado es $ 0,00 y la diferencia se muestra completa.'
                : `${unidades === 1 ? '1 unidad cargada' : `${unidades} unidades cargadas`} · Cargá lo que hay, no lo que esperás.`}
            </p>

            <Button
              type="button"
              variant="ghost"
              onClick={onVaciar}
              className="ml-auto min-h-[var(--size-touch-min)] gap-[var(--space-sm)] rounded-md px-[var(--space-md)] text-[0.8125rem] font-semibold text-foreground transition-colors duration-150 ease-out motion-reduce:transition-none"
            >
              <Eraser aria-hidden="true" className="size-4" />
              Vaciar conteo
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-[var(--space-md)] rounded-lg border border-border bg-card p-[var(--space-lg)]">
          <div className="min-h-0 overflow-y-auto">
            <h3 className="font-sans text-[1.25rem] font-semibold leading-7 tracking-[-0.01em]">
              Resumen del turno
            </h3>
            <p className="mb-[var(--space-sm)] text-xs leading-4 text-muted-foreground">
              {turno.ventasConfirmadas === 1 ? '1 venta confirmada' : `${turno.ventasConfirmadas} ventas confirmadas`}
              {' · '}
              el efectivo es lo único que está en el cajón.
            </p>

            <ResumenDelTurno turno={turno} arqueo={arqueo} />
          </div>

          <div className="grid gap-[var(--space-sm)] border-t border-border pt-[var(--space-md)]">
            <VeredictoArqueo arqueo={arqueo} />

            {error !== null && (
              <p
                role="alert"
                className="rounded-md border border-destructive bg-danger-soft px-[var(--space-sm)] py-[var(--space-sm)] text-xs leading-4 text-danger-soft-foreground"
              >
                {error}
              </p>
            )}

            {motivo !== null && (
              <p id="cierre-motivo" className="text-xs leading-4 text-muted-foreground">
                {motivo}
              </p>
            )}

            {cajonSinCargar && (
              <Button
                type="button"
                variant="ghost"
                aria-pressed={cajonVacioDeclarado}
                onClick={() => setCajonVacioDeclarado(!cajonVacioDeclarado)}
                className={`min-h-[var(--size-touch-min)] w-full justify-center gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] text-[0.8125rem] font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none ${
                  cajonVacioDeclarado
                    ? 'border-primary bg-accent text-accent-foreground'
                    : 'border-border bg-muted text-foreground'
                }`}
              >
                El cajón está vacío
              </Button>
            )}

            <Button
              type="button"
              variant="ghost"
              disabled={!puedeConfirmar}
              aria-describedby={motivo === null ? undefined : 'cierre-motivo'}
              onClick={confirmar}
              className={`flex min-h-[4rem] w-full items-center justify-center gap-[var(--space-sm)] rounded-lg text-sm font-bold tracking-[0.04em] transition-transform duration-150 ease-out motion-reduce:transition-none ${
                puedeConfirmar
                  ? 'bg-primary text-primary-foreground active:scale-[0.985] motion-reduce:active:scale-100'
                  : 'bg-sunken-deep text-foreground'
              }`}
            >
              <Check aria-hidden="true" className="size-[1.125rem]" />
              Confirmar cierre
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={onCancelar}
              className="min-h-[var(--size-control)] w-full justify-center rounded-lg border-border text-[0.8125rem] font-semibold transition-colors duration-150 ease-out motion-reduce:transition-none"
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function Grupo({
  titulo,
  tipo,
  denominaciones,
  conteo,
  onCambiarCantidad,
}: {
  readonly titulo: string
  readonly tipo: TipoDeDenominacion
  readonly denominaciones: readonly Centavos[]
  readonly conteo: ConteoPorDenominacion
  readonly onCambiarCantidad: (denominacion: Centavos, cantidad: number) => void
}) {
  return (
    <div>
      <h3 className="sticky top-0 z-10 flex items-center gap-[var(--space-sm)] bg-muted py-[var(--space-sm)] text-[0.6875rem] font-bold uppercase leading-3.5 tracking-[0.06em] text-muted-foreground">
        {titulo}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </h3>

      <div className="grid gap-[var(--space-xs)] pb-[var(--space-sm)]">
        {denominaciones.map((denominacion) => (
          <FilaDenominacion
            key={denominacion}
            denominacion={denominacion}
            tipo={tipo}
            cantidad={conteo[denominacion] ?? 0}
            onCambiarCantidad={(cantidad) => onCambiarCantidad(denominacion, cantidad)}
          />
        ))}
      </div>
    </div>
  )
}
