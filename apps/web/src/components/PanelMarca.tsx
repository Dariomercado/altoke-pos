import { useState } from 'react'
import type { MarcaTenant } from '@altoke/ui'
import { formatearCentavos } from '../formato'
import {
  MARCA_INICIAL,
  SUPERFICIE_INICIAL,
  TINTA_INICIAL,
  diagnosticoDeMarca,
  logoDeMarca,
  sinLogo,
} from '../marca'

export interface PanelMarcaProps {
  readonly marca: MarcaTenant
  readonly nombreTenant: string
  readonly onCambiar: (marca: MarcaTenant) => void
  readonly onRestablecer: () => void
  readonly onCerrar: () => void
}

type CampoDeColor = 'primary' | 'accent' | 'surface' | 'text'

const ETIQUETA: Readonly<Record<CampoDeColor, string>> = {
  primary: 'Color primario',
  accent: 'Color de acento',
  surface: 'Color de fondo',
  text: 'Color de texto',
}

const CAMPOS: readonly CampoDeColor[] = ['primary', 'accent', 'surface', 'text']

/** Dos líneas de muestra para el ticket del preview: mismas clases que el ticket de verdad. */
const LINEAS_DE_MUESTRA = [
  { nombre: 'Alfajor triple', cantidad: 2, centavos: 2420 },
  { nombre: 'Gaseosa 500 ml', cantidad: 1, centavos: 1500 },
] as const

const TOTAL_DE_MUESTRA = LINEAS_DE_MUESTRA.reduce((suma, linea) => suma + linea.centavos, 0)

/**
 * Panel de marca del tenant (T8).
 *
 * El tenant elige cinco huecos y nada más. El preview no es un dibujo aparte: son las clases reales
 * del POS y del ticket, así que muestra exactamente lo que va a ver el cajero cuando las variables
 * cambian en la raíz.
 *
 * Guard de contraste: lo decide `diagnosticoDeMarca` (el mismo guard que usa el loader), no una
 * copia local. Una marca por debajo de AA no se aplica —queda la anterior— y el aviso dice qué
 * quedó ilegible, con el ratio medido: el par fondo/tinta, o los contenedores del tema claro
 * cuando la marca es oscura y por eso el POS quedaría ilegible en las tarjetas.
 */
export function PanelMarca({
  marca,
  nombreTenant,
  onCambiar,
  onRestablecer,
  onCerrar,
}: PanelMarcaProps) {
  const [logoUrl, setLogoUrl] = useState(() => marca.logoUrl ?? '')
  const [aviso, setAviso] = useState<string | null>(null)

  function cambiarColor(campo: CampoDeColor, valor: string): void {
    const nueva: MarcaTenant = { ...marca, [campo]: valor }
    const diagnostico = diagnosticoDeMarca(nueva)

    if (diagnostico !== null) {
      setAviso(`No se aplicó: ${diagnostico}. Queda la marca anterior.`)
      return
    }

    setAviso(null)
    onCambiar(nueva)
  }

  function cambiarLogo(valor: string): void {
    setLogoUrl(valor)

    const logo = logoDeMarca(valor)

    // Vaciar el campo es pedir "sin logo": el hueco se omite y `aplicarMarca` lo borra.
    if (logo === undefined && valor.trim() !== '') {
      setAviso('El logo tiene que ser una URL http, https o data:image. No se aplicó.')
      return
    }

    setAviso(null)
    onCambiar(logo === undefined ? sinLogo(marca) : { ...marca, logoUrl: logo })
  }

  function restablecer(): void {
    setLogoUrl(MARCA_INICIAL.logoUrl ?? '')
    setAviso(null)
    onRestablecer()
  }

  return (
    <section className="marca" aria-label="Marca del tenant">
      <h2 className="marca__titulo">Marca</h2>
      <p className="marca__ayuda">
        Elegí los colores del local y su logo. El POS y el ticket se actualizan en vivo.
      </p>

      {aviso !== null && (
        <p className="marca__aviso" role="alert">
          {aviso}
        </p>
      )}

      <div className="marca__colores">
        {CAMPOS.map((campo) => (
          <label key={campo} className="marca__fila">
            <span className="campo__etiqueta">{ETIQUETA[campo]}</span>
            <input
              className="marca__color"
              type="color"
              aria-label={ETIQUETA[campo]}
              value={valorDeColor(campo, marca)}
              onChange={(evento) => cambiarColor(campo, evento.target.value)}
            />
          </label>
        ))}
      </div>

      <label className="campo">
        <span className="campo__etiqueta">Logo (URL)</span>
        <input
          className="campo__input"
          type="text"
          aria-label="URL del logo"
          placeholder="https://…"
          value={logoUrl}
          onChange={(evento) => cambiarLogo(evento.target.value)}
        />
      </label>

      <div className="marca__preview">
        <button type="button" className="boton boton--primario">
          Cobrar
        </button>

        <section className="ticket marca__ticket" aria-label="Ticket de muestra">
          <header className="ticket__cabecera">
            <p className="ticket__marca">{nombreTenant}</p>
            <p>Ticket de muestra</p>
          </header>

          <ul className="ticket__items">
            {LINEAS_DE_MUESTRA.map((linea) => (
              <li key={linea.nombre} className="ticket__item">
                <span className="ticket__detalle">
                  {linea.nombre} × {linea.cantidad}
                </span>
                <span className="ticket__importe">{formatearCentavos(linea.centavos)}</span>
              </li>
            ))}
          </ul>

          <p className="ticket__total">
            <span>TOTAL</span>
            <strong>{formatearCentavos(TOTAL_DE_MUESTRA)}</strong>
          </p>
        </section>
      </div>

      <div className="marca__acciones">
        <button type="button" className="boton boton--secundario" onClick={restablecer}>
          Restablecer
        </button>
        <button type="button" className="boton boton--secundario" onClick={onCerrar}>
          Listo
        </button>
      </div>
    </section>
  )
}

/** Valor para un `<input type="color">`: siempre un hex de seis dígitos. */
function valorDeColor(campo: CampoDeColor, marca: MarcaTenant): string {
  switch (campo) {
    case 'primary':
      return marca.primary
    case 'accent':
      return marca.accent
    case 'surface':
      return marca.surface ?? SUPERFICIE_INICIAL
    case 'text':
      return marca.text ?? TINTA_INICIAL
  }
}
