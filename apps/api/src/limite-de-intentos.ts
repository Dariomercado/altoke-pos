/**
 * Rate limit del login (`0003` §Auth, `demasiados_intentos`).
 *
 * Es una ventana **fija** por clave: la cuenta arranca con el primer intento fallido y se suelta
 * entera cuando pasa la ventana, en vez de correrse con cada intento. La alternativa —una ventana
 * deslizante— premia al que reintenta despacio: cada intento nuevo correría el final y el bloqueo
 * nunca llegaría.
 *
 * En memoria y **por proceso**, a propósito: M2 corre una sola instancia y un limitador que necesita
 * una base para contar es una consulta de más en el camino que justamente quiere ser barato. El día
 * que haya más de una instancia, esto tiene que mudarse a algo compartido; hasta entonces, una
 * instancia que se reinicia olvida los intentos, que es el modo de falla tolerable.
 */

export type ResultadoDeIntento = {
  readonly permitido: boolean
  /** Segundos hasta que la ventana se suelte; `0` cuando el intento pasa. */
  readonly reintentarEnSegundos: number
}

export type LimiteDeIntentos = {
  /** Registra un intento fallido y dice si estaba permitido. */
  intentar(clave: string): ResultadoDeIntento
  /** Un acierto borra la cuenta: quien entró bien no arrastra los intentos previos. */
  registrarExito(clave: string): void
  tamano(): number
}

export type OpcionesLimiteDeIntentos = {
  readonly maximo: number
  readonly ventanaMs: number
  readonly ahora?: (() => number) | undefined
  /** Tope de claves vivas: sin esto, un ataque con emails inventados crece sin fin. */
  readonly capacidad?: number | undefined
}

export const MAXIMO_INTENTOS_POR_DEFECTO = 10
export const VENTANA_DE_INTENTOS_POR_DEFECTO = 5 * 60_000
export const CAPACIDAD_POR_DEFECTO = 10_000

type Cuenta = {
  readonly desde: number
  intentos: number
}

export function crearLimiteDeIntentos(opciones: OpcionesLimiteDeIntentos): LimiteDeIntentos {
  const ahora = opciones.ahora ?? (() => Date.now())
  const capacidad = opciones.capacidad ?? CAPACIDAD_POR_DEFECTO
  const cuentas = new Map<string, Cuenta>()

  function vigente(clave: string, instante: number): Cuenta | undefined {
    const cuenta = cuentas.get(clave)
    if (cuenta === undefined) return undefined
    if (instante - cuenta.desde < opciones.ventanaMs) return cuenta

    cuentas.delete(clave)
    return undefined
  }

  function abrir(clave: string, instante: number): Cuenta {
    // Desalojo FIFO de la más vieja: `Map` conserva el orden de inserción y lo que se desaloja es lo
    // que ya nadie está martillando.
    if (cuentas.size >= capacidad) {
      const masVieja = cuentas.keys().next()
      if (masVieja.done !== true) cuentas.delete(masVieja.value)
    }

    const cuenta: Cuenta = { desde: instante, intentos: 0 }
    cuentas.set(clave, cuenta)
    return cuenta
  }

  return {
    intentar(clave) {
      const instante = ahora()
      const cuenta = vigente(clave, instante) ?? abrir(clave, instante)

      if (cuenta.intentos >= opciones.maximo) {
        const faltan = cuenta.desde + opciones.ventanaMs - instante
        return { permitido: false, reintentarEnSegundos: Math.max(1, Math.ceil(faltan / 1000)) }
      }

      cuenta.intentos += 1
      return { permitido: true, reintentarEnSegundos: 0 }
    },

    registrarExito(clave) {
      cuentas.delete(clave)
    },

    tamano() {
      return cuentas.size
    },
  }
}
