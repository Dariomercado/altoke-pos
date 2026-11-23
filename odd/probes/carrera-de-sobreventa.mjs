#!/usr/bin/env node
/**
 * Sonda de la carrera de sobreventa (docs/specs/0003-api-y-sync.md §Sobreventa).
 *
 * `POST /sync/eventos` serializa la detección de sobreventa por tenant con
 * `pg_advisory_xact_lock`: dos terminales que venden la última unidad a la vez tienen que ver, la
 * segunda, la venta de la primera ya escrita. Sin el lock, la alerta se pierde y el stock queda
 * negativo sin que nadie lo cuente.
 *
 * **Por qué es una sonda y no un test de la suite.** La carrera necesita dos conexiones HTTP reales
 * y un Postgres real; `app.inject` comparte el proceso y no la reproduce (pasó 4/4 con el lock
 * removido). Un test que a veces pasa no prueba nada. Esta sonda se corre a mano contra una API
 * levantada, imprime lo que observó y sale con código distinto de cero si la alerta no está.
 *
 * Uso:
 *
 *     node odd/probes/carrera-de-sobreventa.mjs
 *     PROBE_API=http://localhost:3001 PROBE_RONDAS=6 node odd/probes/carrera-de-sobreventa.mjs
 *
 * `PROBE_API` es la base de la API (default `http://localhost:3001`) y `PROBE_RONDAS` cuántas
 * carreras correr (default 6: con el lock roto, una sola ronda puede tener suerte).
 */

import { randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

const BASE = (process.env.PROBE_API ?? 'http://localhost:3001').replace(/\/+$/, '')
const RONDAS = Number(process.env.PROBE_RONDAS ?? 6)
const PASSWORD = 'sonda-contraseña-larga'

if (!Number.isInteger(RONDAS) || RONDAS < 1) {
  console.error(`PROBE_RONDAS tiene que ser un entero positivo, no ${String(process.env.PROBE_RONDAS)}`)
  process.exit(2)
}

/**
 * Un pedido con su propia conexión (`agent: false`): dos pedidos concurrentes no pueden compartir
 * un socket, que es justo lo que la carrera necesita para ser real.
 */
function pedir(metodo, ruta, { token, cuerpo } = {}) {
  return new Promise((resolver, rechazar) => {
    const url = new URL(ruta, `${BASE}/`)
    const datos = cuerpo === undefined ? undefined : Buffer.from(JSON.stringify(cuerpo))
    const modulo = url.protocol === 'https:' ? https : http

    const solicitud = modulo.request(
      url,
      {
        method: metodo,
        agent: false,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(datos === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': datos.length }),
        },
      },
      (respuesta) => {
        const trozos = []
        respuesta.on('data', (trozo) => trozos.push(trozo))
        respuesta.on('end', () => {
          const texto = Buffer.concat(trozos).toString('utf8')
          let json
          try {
            json = texto === '' ? undefined : JSON.parse(texto)
          } catch {
            json = undefined
          }
          resolver({ estado: respuesta.statusCode, texto, json })
        })
      },
    )

    solicitud.on('error', rechazar)
    if (datos !== undefined) solicitud.write(datos)
    solicitud.end()
  })
}

function exigir(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje)
}

async function esperar(respuesta, estado, contexto) {
  exigir(
    respuesta.estado === estado,
    `${contexto}: esperaba ${estado} y recibí ${String(respuesta.estado)}: ${respuesta.texto}`,
  )
  return respuesta.json
}

function evento(tenantId, terminalId, secuencia, resto) {
  return {
    id: randomUUID(),
    tenantId,
    terminalId,
    secuencia,
    ocurridoEn: new Date().toISOString(),
    schemaVersion: 1,
    ...resto,
  }
}

async function empujar(token, terminalId, eventos) {
  const respuesta = await pedir('POST', '/sync/eventos', {
    token,
    cuerpo: { terminalId, eventos },
  })
  const cuerpo = await esperar(respuesta, 200, `empujar ${terminalId}`)
  return cuerpo
}

async function traer(token, terminalId) {
  const consulta = new URLSearchParams({ terminalId })
  const respuesta = await pedir('GET', `/sync/eventos?${consulta.toString()}`, { token })
  return esperar(respuesta, 200, `traer ${terminalId}`)
}

async function main() {
  console.log(`Sonda de sobreventa contra ${BASE} (${RONDAS} ronda/s)`)

  const sufijo = randomUUID().slice(0, 8)
  const registro = await pedir('POST', '/auth/registro', {
    cuerpo: {
      email: `sonda-${sufijo}@altoke.test`,
      password: PASSWORD,
      nombre: 'Sonda de sobreventa',
      tenant: { nombre: `Sonda ${sufijo}`, slug: `sonda-${sufijo}` },
    },
  })
  const cuenta = await esperar(registro, 201, 'registrar el tenant de la sonda')
  const { token, tenant } = cuenta
  console.log(`tenant de la sonda: ${tenant.slug} (${tenant.id})`)

  const terminalStock = `sonda-stock-${sufijo}`
  const terminalA = `sonda-a-${sufijo}`
  const terminalB = `sonda-b-${sufijo}`
  const lectora = `sonda-lectora-${sufijo}`

  /** Lo que la sonda vio, ronda por ronda, para imprimirlo al final. */
  const observado = []

  for (let ronda = 1; ronda <= RONDAS; ronda += 1) {
    const sku = `sonda-sku-${ronda}-${sufijo}`

    // Stock 1: la semilla es un ajuste, no mueve la sobreventa.
    const semilla = await empujar(token, terminalStock, [
      evento(tenant.id, terminalStock, ronda, {
        tipo: 'ajuste_stock',
        sku,
        delta: 1,
        causa: 'compra',
      }),
    ])
    exigir(
      semilla.aceptados.length === 1,
      `ronda ${ronda}: la semilla no se aceptó: ${JSON.stringify(semilla)}`,
    )

    const ventaA = `sonda-venta-a-${ronda}-${sufijo}`
    const ventaB = `sonda-venta-b-${ronda}-${sufijo}`

    // Las dos ventas de la última unidad, cada una en su conexión y en el mismo instante.
    const [a, b] = await Promise.all([
      empujar(token, terminalA, [
        evento(tenant.id, terminalA, ronda, {
          tipo: 'item_agregado',
          ventaId: ventaA,
          sku,
          cantidad: 1,
          precioUnitarioCentavos: 100,
        }),
      ]),
      empujar(token, terminalB, [
        evento(tenant.id, terminalB, ronda, {
          tipo: 'item_agregado',
          ventaId: ventaB,
          sku,
          cantidad: 1,
          precioUnitarioCentavos: 100,
        }),
      ]),
    ])

    for (const [nombre, respuesta] of [
      ['A', a],
      ['B', b],
    ]) {
      exigir(
        respuesta.aceptados.length === 1,
        `ronda ${ronda}: la venta de ${nombre} no se aceptó: ${JSON.stringify(respuesta)}`,
      )
    }

    const traida = await traer(token, lectora)
    const alertas = traida.eventos.filter(
      (evento) => evento.tipo === 'sobreventa_detectada' && evento.sku === sku,
    )

    observado.push({
      ronda,
      sku,
      aceptadas: a.aceptados.length + b.aceptados.length,
      alertas: alertas.length,
      stockProyectado: alertas[0]?.stockProyectado,
    })

    exigir(
      alertas.length === 1,
      `ronda ${ronda}: esperaba exactamente 1 sobreventa_detectada para ${sku} y recibí ${alertas.length}. ` +
        `Observed: ${JSON.stringify(traida.eventos, null, 2)}`,
    )
    exigir(
      alertas[0].stockProyectado === -1,
      `ronda ${ronda}: esperaba stockProyectado -1 y recibí ${String(alertas[0].stockProyectado)}`,
    )

    console.log(
      `ronda ${ronda}: ventas aceptadas A y B, 1 alerta con stockProyectado ${alertas[0].stockProyectado}`,
    )
  }

  console.log(`\nResultado: ${RONDAS}/${RONDAS} rondas con exactamente una alerta y stockProyectado -1`)
  console.log(JSON.stringify(observado, null, 2))
}

main().catch((error) => {
  console.error(`\nFALLÓ: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
