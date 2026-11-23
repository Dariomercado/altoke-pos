/**
 * El estado de sesión de la terminal: arranque, login, alta, elección de tenant y cierre.
 *
 * La regla dura es la de `0001` §I2: **la red nunca decide una venta**. Por eso un arranque sin
 * red no borra la sesión guardada; se abre el POS con la última sesión que el servidor confirmó.
 * Sólo un rechazo explícito del servidor (`no_autenticado` / `sin_permiso`) borra el token y vuelve
 * al login, y lo hace una vez, sin reintentar en loop.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AlmacenDeSesion } from './almacen.ts'
import type { ClienteDeSesion, ErrorDeSesion } from './cliente.ts'
import type { Membresia, RespuestaYo, SesionActiva, Usuario } from './tipos.ts'

export type EstadoDeSesion =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin_sesion'; readonly aviso: ErrorDeSesion | null }
  | {
      readonly tipo: 'eligiendo'
      readonly token: string
      readonly usuario: Usuario
      readonly membresias: readonly Membresia[]
    }
  | { readonly tipo: 'activa'; readonly sesion: SesionActiva }

export interface OpcionesDeSesion {
  readonly almacen: AlmacenDeSesion
  readonly cliente: ClienteDeSesion
  readonly purgar: (tenantId: string) => Promise<void>
  /**
   * Inyectable para tests: `undefined` arranca desde el almacén, `null` es "sin sesión" explícito
   * y una sesión salta el arranque. El POS viejo se sigue pudiendo renderizar sin servidor.
   */
  readonly inicial: SesionActiva | null | undefined
}

export interface AccionesDeSesion {
  readonly iniciarSesion: (email: string, password: string) => Promise<ErrorDeSesion | null>
  readonly registrar: (datos: {
    readonly nombre: string
    readonly email: string
    readonly password: string
    readonly tenant: { readonly nombre: string; readonly slug: string }
  }) => Promise<ErrorDeSesion | null>
  readonly elegirTenant: (membresia: Membresia) => Promise<void>
  readonly cerrarSesion: () => Promise<void>
}

function sesionDesdeMembresia(
  token: string,
  usuario: Usuario,
  membresia: Membresia,
): SesionActiva {
  return {
    token,
    usuario,
    tenant: { id: membresia.tenantId, slug: membresia.slug, nombre: membresia.nombre },
    rol: membresia.rol,
  }
}

async function guardarSeguro(almacen: AlmacenDeSesion, sesion: SesionActiva): Promise<void> {
  try {
    await almacen.guardar(sesion)
  } catch {
    // Sin storage (modo privado, cuota) la sesión vive en memoria hasta recargar. No es motivo
    // para dejar al dueño afuera de su propio kiosco.
  }
}

async function borrarSeguro(almacen: AlmacenDeSesion): Promise<void> {
  try {
    await almacen.borrar()
  } catch {
    // Un storage roto no puede bloquear el botón de salir.
  }
}

export function useSesion(opciones: OpcionesDeSesion): {
  readonly estado: EstadoDeSesion
  readonly acciones: AccionesDeSesion
} {
  const { almacen, cliente, purgar, inicial } = opciones

  const [estado, setEstado] = useState<EstadoDeSesion>(() =>
    inicial === undefined
      ? { tipo: 'cargando' }
      : inicial === null
        ? { tipo: 'sin_sesion', aviso: null }
        : { tipo: 'activa', sesion: inicial },
  )

  /**
   * Con una sola membresía el tenant está decidido. Con varias, la última elegida (el slug
   * guardado) se conserva; si no está entre las membresías actuales, **se elige a mano**: nunca
   * se adivina el kiosco donde el usuario va a cobrar.
   */
  const aplicarYo = useCallback(
    async (
      token: string,
      usuario: Usuario,
      yo: RespuestaYo,
      preferido: string | undefined,
    ): Promise<void> => {
      const membresias = yo.membresias

      if (membresias.length === 0) {
        await borrarSeguro(almacen)
        setEstado({
          tipo: 'sin_sesion',
          aviso: { motivo: 'sin_permiso', mensaje: 'Tu cuenta no pertenece a ningún kiosco.' },
        })
        return
      }

      if (membresias.length === 1) {
        const unica = membresias[0]
        if (unica === undefined) return

        const sesion = sesionDesdeMembresia(token, usuario, unica)
        await guardarSeguro(almacen, sesion)
        setEstado({ tipo: 'activa', sesion })
        return
      }

      const elegida =
        preferido === undefined ? undefined : membresias.find((m) => m.slug === preferido)

      if (elegida !== undefined) {
        const sesion = sesionDesdeMembresia(token, usuario, elegida)
        await guardarSeguro(almacen, sesion)
        setEstado({ tipo: 'activa', sesion })
        return
      }

      setEstado({ tipo: 'eligiendo', token, usuario, membresias })
    },
    [almacen],
  )

  useEffect(() => {
    if (inicial !== undefined) {
      setEstado(
        inicial === null ? { tipo: 'sin_sesion', aviso: null } : { tipo: 'activa', sesion: inicial },
      )
      return
    }

    let vigente = true

    async function abrir(): Promise<void> {
      let guardada: SesionActiva | null = null
      try {
        guardada = await almacen.leer()
      } catch {
        guardada = null
      }

      if (!vigente) return
      if (guardada === null) {
        setEstado({ tipo: 'sin_sesion', aviso: null })
        return
      }

      const respuesta = await cliente.yo(guardada.token, guardada.tenant.slug)
      if (!vigente) return

      if (!respuesta.ok) {
        if (respuesta.error.motivo === 'no_autenticado' || respuesta.error.motivo === 'sin_permiso') {
          await borrarSeguro(almacen)
          if (vigente) setEstado({ tipo: 'sin_sesion', aviso: respuesta.error })
          return
        }

        // Sin red o respuesta que el contrato no entiende: se abre con lo último confirmado. El
        // POS cobra igual y el sync dirá que no hay red; no se expulsa al cajero del mostrador.
        setEstado({ tipo: 'activa', sesion: guardada })
        return
      }

      await aplicarYo(guardada.token, respuesta.dato.usuario, respuesta.dato, guardada.tenant.slug)
    }

    void abrir()

    return () => {
      vigente = false
    }
  }, [inicial, almacen, cliente, aplicarYo])

  const iniciarSesion = useCallback(
    async (email: string, password: string): Promise<ErrorDeSesion | null> => {
      const respuesta = await cliente.iniciarSesion(email, password)
      if (!respuesta.ok) return respuesta.error

      const { token, usuario, tenant, rol } = respuesta.dato
      const sesion: SesionActiva = { token, usuario, tenant, rol }

      const yo = await cliente.yo(token, tenant.slug)
      if (!yo.ok) {
        if (yo.error.motivo === 'no_autenticado' || yo.error.motivo === 'sin_permiso') {
          await borrarSeguro(almacen)
          setEstado({ tipo: 'sin_sesion', aviso: yo.error })
          return yo.error
        }

        // Sin red justo después de entrar: se guarda la sesión que el servidor acaba de emitir y
        // se abre el POS. El tenant de esa respuesta es el único que el servidor puede haber usado.
        await guardarSeguro(almacen, sesion)
        setEstado({ tipo: 'activa', sesion })
        return null
      }

      // Con más de una membresía la elección es del usuario: el tenant de la respuesta no se toma
      // como elegido. Si hay una sola, `aplicarYo` la resuelve sin preguntar.
      await aplicarYo(token, yo.dato.usuario, yo.dato, undefined)
      return null
    },
    [cliente, almacen, aplicarYo],
  )

  const registrar = useCallback(
    async (datos: {
      readonly nombre: string
      readonly email: string
      readonly password: string
      readonly tenant: { readonly nombre: string; readonly slug: string }
    }): Promise<ErrorDeSesion | null> => {
      const respuesta = await cliente.registro(datos)
      if (!respuesta.ok) return respuesta.error

      const { token, usuario, tenant, rol } = respuesta.dato
      const sesion: SesionActiva = { token, usuario, tenant, rol }

      const yo = await cliente.yo(token, tenant.slug)
      if (!yo.ok) {
        if (yo.error.motivo === 'no_autenticado' || yo.error.motivo === 'sin_permiso') {
          await borrarSeguro(almacen)
          setEstado({ tipo: 'sin_sesion', aviso: yo.error })
          return yo.error
        }

        // Sin red justo después de entrar: se guarda la sesión que el servidor acaba de emitir y
        // se abre el POS. El tenant de esa respuesta es el único que el servidor puede haber usado.
        await guardarSeguro(almacen, sesion)
        setEstado({ tipo: 'activa', sesion })
        return null
      }

      // Con más de una membresía la elección es del usuario: el tenant de la respuesta no se toma
      // como elegido. Si hay una sola, `aplicarYo` la resuelve sin preguntar.
      await aplicarYo(token, yo.dato.usuario, yo.dato, undefined)
      return null
    },
    [cliente, almacen, aplicarYo],
  )

  const elegirTenant = useCallback(
    async (membresia: Membresia): Promise<void> => {
      if (estado.tipo !== 'eligiendo') return

      const sesion = sesionDesdeMembresia(estado.token, estado.usuario, membresia)
      await guardarSeguro(almacen, sesion)
      setEstado({ tipo: 'activa', sesion })
    },
    [estado, almacen],
  )

  const cerrarSesion = useCallback(async (): Promise<void> => {
    const actual = estado
    const token =
      actual.tipo === 'activa'
        ? actual.sesion.token
        : actual.tipo === 'eligiendo'
          ? actual.token
          : null
    const tenantId = actual.tipo === 'activa' ? actual.sesion.tenant.id : null

    await borrarSeguro(almacen)

    // Revocar es mejor esfuerzo: la terminal se cierra aunque el servidor no conteste.
    if (token !== null) {
      try {
        void cliente.revocar(token).catch(() => {})
      } catch {
        // Un cliente roto no puede dejar el botón de salir a mitad de camino.
      }
    }

    if (tenantId !== null) {
      try {
        await purgar(tenantId)
      } catch {
        // `purgarTenantLocal` ya no lanza; un doble roto tampoco puede dejar el login trabado.
      }
    }

    setEstado({ tipo: 'sin_sesion', aviso: null })
  }, [estado, almacen, cliente, purgar])

  return {
    estado,
    acciones: { iniciarSesion, registrar, elegirTenant, cerrarSesion },
  }
}
