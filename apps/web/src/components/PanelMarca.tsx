import { useState } from 'react'
import { CONTRASTE_MINIMO, contraste, esContrasteLegible } from '@altoke/ui'
import type { MarcaTenant } from '@altoke/ui'
import { formatearCentavos } from '../formato'
import { MARCA_INICIAL, SUPERFICIE_INICIAL, TINTA_INICIAL, esLogoValido } from '../marca'

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
 * Guard de contraste: un par texto/fondo por debajo de AA no se aplica. La edición se rechaza
 * entera —queda la marca anterior— y el aviso dice qué par quedó ilegible, con el ratio medido.
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

  const superficie = marca.surface ?? SUPERFICIE_INICIAL
  const tinta = marca.text ?? TINTA_INICIAL

  function cambiarColor(campo: CampoDeColor, valor: string): void {
    const nueva: MarcaTenant = { ...marca, [campo]: valor }

    if (campo === 'surface' || campo === 'text') {
      const fondo = normalizarHex(nueva.surface, superficie)
      const texto = normalizarHex(nueva.text, tinta)

      if (!esContrasteLegible(texto, fondo)) {
        setAviso(
          `No se aplicó: el texto ${texto} sobre el fondo ${fondo} no es legible ` +
            `(${ratioLegible(contraste(texto, fondo))}; el mínimo es ` +
            `${ratioLegible(CONTRASTE_MINIMO)}). Queda la marca anterior.`,
        )
        return
      }
    }

    setAviso(null)
    onCambiar(nueva)
  }

  function cambiarLogo(valor: string): void {
    setLogoUrl(valor)

    // Vaciar el campo es pedir "sin logo": el hueco se omite y `aplicarMarca` lo borra.
    if (valor.trim() !== '' && !esLogoValido(valor)) {
      setAviso('El logo tiene que ser una URL http, https o data:image. No se aplicó.')
      return
    }

    setAviso(null)
    onCambiar({ ...marca, logoUrl: valor.trim() })
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

/** El input de color sólo entrega `#rrggbb`, pero el tipo dice `string`: se sanea igual. */
function normalizarHex(valor: string | undefined, porDefecto: string): string {
  return valor !== undefined && /^#[0-9a-f]{6}$/i.test(valor) ? valor.toLowerCase() : porDefecto
}

/** Ratio WCAG con coma decimal: `4,52:1` es como se lee en español. */
function ratioLegible(ratio: number): string {
  return `${ratio.toFixed(2).replace('.', ',')}:1`
}
