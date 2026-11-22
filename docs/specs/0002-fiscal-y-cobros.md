# AlToke — Spec técnica 0002: Fiscalidad y cobros

**Estado:** propuesta para discusión. Sin código todavía.
**Depende de:** `0001-arquitectura.md` (invariantes I1–I3, puertos, libro de eventos).

---

## 0. La pregunta que originó este documento

> "La idea sería poder ofrecerlo a todos los kioscos y tiendas, no importa si están con AFIP o si usan
> otra forma. ¿Debería hacerse un sistema que soporte integración de cualquier plataforma de
> facturación AFIP u otros?"

**No — ni por asomo.** Pero la conclusión correcta no es "entonces elegimos un proveedor y obligamos al
cliente a cambiar". Es esta:

> **La completitud no viene de N integraciones. Viene de un contrato + un camino de degradación + un
> fallback manual.**

La diferencia es comercial, no filosófica:

| Enfoque | Qué prometés | Qué te cuesta |
|---|---|---|
| "Integramos con 12 facturadores" | Mantener 12 APIs ajenas que cambian sin avisarte | Alto y permanente |
| "AlToke no te obliga a cambiar cómo facturás" | Lo mismo para el cliente | Casi cero |

---

## 1. Por qué "soportar cualquier plataforma" es una trampa

1. **Superficie de mantenimiento sin palanca.** Cada integración es código que se rompe cuando el
   otro cambia, y no facturás por mantenerla.
2. **Certificaciones.** Terminales de pago requieren homologación por proveedor. No es "escribir un
   adapter", es un trámite.
3. **Ningún cliente elige el producto por eso.** El kiosquero no compra integraciones; compra no
   perder ventas y no pelear con la caja a las 12:30.
4. **Riesgo legal asimétrico.** Si el comprobante sale mal, el problema es del kiosco — pero la culpa
   te la llevás vos, porque tu logo está en la pantalla.

---

## 2. La clasificación real: 4 modos, no N proveedores

Todo comercio minorista argentino cae en exactamente uno de cuatro modos. Ese es el mercado completo.

| # | Modo | Cómo factura hoy | Qué hace AlToke |
|---|---|---|---|
| **F0** | Sin comprobante fiscal | no emite, o emite a mano | ticket interno, sin pretensión fiscal |
| **F1** | Controlador fiscal propio | impresora fiscal con memoria fiscal | le manda los comandos; el comprobante lo emite la impresora |
| **F2** | Facturador externo | otra app o web: el contador, el banco, un SaaS | registra la venta y **asiste** el comprobante |
| **F3** | WSFE nativo | nada; AlToke lo hace | emite CAE contra el web service |

> **Verificado contra fuente oficial:** el organismo es **ARCA** (Agencia de Recaudación y Control
> Aduanero), ex AFIP. Los **monotributistas están alcanzados** por la obligación de emitir comprobantes,
> igual que los responsables inscriptos y los exentos.
> [`arca.gob.ar/fe/emision-autorizacion/sujetos.asp`]
>
> Y las dos modalidades son **opcionales y combinables**: *"podrán optar por una de las 2 modalidades de
> emisión de comprobantes, o ambas en forma conjunta"*. [`arca.gob.ar/facturacion/comprobantes/fe-vs-cf.asp`]
>
> F1 y F3 no son un invento de este documento: son exactamente las dos modalidades que la norma contempla.

### F0 no es un modo legal — es una realidad comercial

Esto corrige una premisa de la primera versión de este documento. **Todos los kioscos están obligados a
emitir comprobante**, incluidos los monotributistas. F0 no es "un modo válido de operar": es "el cliente
hoy no cumple".

Tres consecuencias:

1. **AlToke no puede ser el instrumento del incumplimiento.** El ticket interno no se llama factura, no
   lleva numeración fiscal y declara que no es comprobante válido. No es letra chica legal: es lo que te
   protege.
2. **F0 es un estado de transición, no un destino.** El onboarding debería empujar a F2 nivel 1 apenas el
   cliente tenga clave fiscal, porque el camino legal más barato ya existe.
3. **La ruta legal más barata para un kiosco monotributista es gratis.** "Comprobantes en Línea" del portal
   de ARCA no cuesta nada y no requiere integración. Ahí es donde F2 nivel 1 brilla: AlToke **prepara** el
   comprobante, el kiosquero lo pega en el portal, y queda asociado a la venta. Cero integración, cero
   incumplimiento.

Dato de dirección: ARCA está **ampliando** la obligación a sujetos hoy no alcanzados. La tendencia es que
F3 gane valor con el tiempo — otra razón para no construirlo primero, y sí para dejar el puerto listo.

El tenant **declara su modo en el onboarding**. No es una preferencia escondida en ajustes: es la
primera pregunta del alta y define qué ve el cajero en el mostrador.

### F1 — Controlador fiscal

El más común en kioscos chicos. La impresora (Hasar, Epson, Bematech, Telesonic, Newland) tiene memoria
fiscal y numeración propia; el POS le habla por protocolo IFD sobre serial/USB/red.

**Consecuencia arquitectónica:** el comprobante **no lo emite AlToke**, lo emite la impresora. AlToke
manda: abrir comprobante (tipo, documento, importe, alícuota) → ítems → cerrar → recibe número,
fecha/hora y datos de CAE/CAI más el payload del QR.

Es la integración más valiosa y más barata del conjunto: **un protocolo, muchos modelos**. Modelo nuevo
= driver nuevo, no arquitectura nueva.

### F2 — Facturador externo

La mayoría **ya tiene algo**: el contador le cargó un sistema, o usa la web del banco, o factura desde
la app del monotributo.

Acá está el insight que evita el 90% del trabajo: **este modo no necesita integración, necesita
asistencia.** Dos niveles, en ese orden:

1. **Nivel 1 — siempre funciona, cero integración.** AlToke le deja al cajero el comprobante listo para
   copiar: tipo, punto de venta, documento del receptor, importes desglosados y detalle. El cajero lo
   carga en su sistema y pega el número en AlToke, quedando asociado a la venta.
2. **Nivel 2 — sólo si el proveedor tiene API pública estable.** Push automático. Se construye cuando
   **un cliente concreto lo pide y lo paga**, nunca de forma especulativa.

Esto es lo que cubre "cualquier plataforma": no integrándolas todas, sino haciendo que **el modo de
menor integración sea suficientemente bueno para no bloquear la venta**.

### F3 — WSFE nativo

El único modo donde AlToke es el emisor técnico. Requiere:

- Certificado y clave privada **del tenant** (no de AlToke), tramitados con su CUIT.
- Delegación del web service a ese certificado.
- Punto de venta habilitado.
- **WSAA**: token de vida corta (~12 h) que hay que renovar solo, con margen. Si vence en medio de un
  turno y no hay red, no hay CAE.
- Homologación antes de producción.

Por eso **no va en v1**.

### 2.1 Cuándo se construye F3 (y por qué no es cuestión de tamaño ni de cantidad de clientes)

La pregunta natural es "¿F3 es para tiendas grandes?" o "¿va cuando tenga diez clientes?". Ninguna de
las dos es el criterio.

> **F3 es para el cliente que hoy NO PUEDE emitir el comprobante que su negocio necesita.**
> Es una pregunta de **capacidad**, no de volumen.

El disparador, como predicado y no como número:

> Se construye F3 cuando un cliente concreto **no se puede incorporar de ninguna otra manera** y ese
> cliente **va a pagar**. Diez clientes no es la causa: es el punto donde ya tenés evidencia de qué
> segmento compra, en lugar de una muestra de uno.

**Por qué no antes:**

1. **F3 es el único modo donde AlToke es el emisor.** Los otros tres son convivencia; éste es
   responsabilidad propia. Un CAE que falla un sábado a la noche es **tu** pager, no el del kiosco.
2. **Es lo que menos diferencia.** Todos los competidores lo tienen. Es requisito de entrada, no
   ventaja competitiva. Construirlo primero es gastar el presupuesto de innovación en la pieza más
   commodity del sistema.
3. **El cliente que más necesita F3 es el que más te puede reclamar.** El que factura 500 veces al día
   y no tiene controlador fiscal es justamente quien tiene un contador mirando y motivos para
   indemnizar. No querés que sean tus primeros diez clientes.
4. **Es el único de los cuatro modos que no funciona sin internet.** Los otros tres sí.

### Quién pide F3 de verdad

| Cliente | ¿Necesita F3? | Qué hacer |
|---|---|---|
| Kiosco monotributista que no factura | No | F0 |
| Kiosco con impresora fiscal | **No — F1 es mejor** | F1: funciona sin red y el comprobante lo emite la impresora |
| Tienda de ropa que factura desde el sistema del contador | No | F2 nivel 1 |
| **Ferretería que vende a empresas y hoy hace Factura A a mano en el portal** | **Sí** | Éste es el caso F3 real |
| Tienda RI con 3 sucursales y sin controlador fiscal | Sí | F3 — pero es un cliente de M5, no de M1 |

## Nota sobre el disparador de F3

**Lo que dispara F3 no es "vender B2B", es ser Responsable Inscripto.** Un monotributista emite
**siempre Factura C, sin discriminar IVA, aunque le venda a una empresa** — la empresa no puede tomar
crédito fiscal, y eso es un problema de la empresa, no del kiosco. Verificado en
[`arca.gob.ar/facturacion/monotributo/comprobantes.asp`].

Eso achica el universo de F3 bastante más de lo que parece: el cliente que la necesita es un **RI sin
controlador fiscal**. En kioscos de barrio, ese perfil casi no existe. Por eso F3 va tan tarde.

El patrón que importa: **F3 lo pide quien es RI y hoy emite a mano.** Y ese cliente, si lo conseguís,
justifica el costo — pero lo conseguís *porque* AlToke ya le resolvió el mostrador, no al revés.

**Corolario comercial:** si el 90% del mercado es F0, F1 o F2, entonces **podés lanzar el producto
completo sin escribir una línea de F3**. Y cuando aparezca el cliente que lo necesita, es un proyecto
vendible por separado, no un costo hundido.

---

## 3. El modelo normalizado de comprobante

Independiente del modo, el dominio produce y consume una sola forma:

```ts
type TipoComprobante =
  | 'A' | 'B' | 'C'
  | 'nota_credito_a' | 'nota_credito_b' | 'nota_credito_c'
  | 'interno'

type CondicionIva = 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final'

interface Comprobante {
  tenantId: string
  ventaId: string
  tipo: TipoComprobante
  puntoDeVenta: number
  numero: number                    // lo asigna el emisor, nunca AlToke
  emitidoEn: string
  receptor: { docTipo: number; docNro: string; condicionIva: CondicionIva }
  alicuotas: { id: number; baseCentavos: number; importeCentavos: number }[]
  importeNetoCentavos: number
  importeIvaCentavos: number
  importeTotalCentavos: number
  emisor: 'altoke_wsfe' | 'controlador_fiscal' | 'externo' | 'ninguno'
  identificadorExterno?: { tipo: 'cae' | 'cai' | 'numero_manual'; valor: string; venceEn?: string }
  qrPayload?: string
  estado: 'pendiente' | 'emitido' | 'fallido' | 'reemplazado'
}
```

Dos decisiones fuertes:

- **`numero` lo asigna el emisor, nunca AlToke.** En F1 lo da la impresora, en F3 lo da el CAE, en F2 lo
  da el otro sistema. AlToke jamás inventa numeración fiscal — eso es precisamente lo que convierte un
  bug en un problema con el organismo.
- **La corrección es un documento nuevo, no un `UPDATE`.** Una nota de crédito es otro comprobante que
  apunta al anterior. Igual que el libro de eventos de `0001`: nunca se reescribe la historia.

### Un detalle que el mockup de Stitch tiene mal

Stitch muestra **IVA discriminado 21%** en el ticket. Eso es Factura A/B de Responsable Inscripto. Pero
el grueso del segmento es **monotributista**, que emite **Factura C sin discriminar IVA**.

Si el modelo asume IVA discriminado siempre, el sistema emite mal para la mayoría de tus clientes.

→ `alicuotas` tiene que poder estar vacío, y el modo fiscal del tenant decide qué campos existen. No al
revés.

---

## 4. Consistencia: la venta es inmediata, el comprobante es eventual

Este es el nudo del documento, y conecta directo con la decisión de offline.

- **La venta se confirma local e inmediatamente.** El cliente ya se fue con el alfajor.
- **El comprobante es un efecto externo** (invariante I2). Vive en un outbox con sus propios estados:
  `pendiente → emitido | fallido → reintento`.
- **Una venta sin comprobante es una venta válida con deuda documental.** Se ve como alerta, no como
  error, y aparece en el cierre de turno.

```
                          ┌─────────────┐
      venta confirmada ──▶│  pendiente  │
                          └──────┬──────┘
                    intenta     │     reintenta (backoff)
                     ┌──────────┴──────────┐
                     ▼                     ▼
               ┌──────────┐          ┌──────────┐
               │ emitido  │          │ fallido  │──▶ requiere acción humana
               └────┬─────┘          └──────────┘
                    │ (anulación)
                    ▼
              ┌──────────────┐
              │ reemplazado  │  nota de crédito + comprobante nuevo
              └──────────────┘
```

**Regla dura: nunca se pierde una venta por un problema fiscal.** Si el CAE no llega, el turno igual
cierra con la venta adentro y el comprobante marcado.

### Contingencia por modo

Son distintas y no se promete magia:

| Modo | Sin internet |
|---|---|
| **F0** | funciona igual, no depende de nada |
| **F1** | **funciona** — la impresora fiscal no necesita red. El modo más robusto. |
| **F2 nivel 1** | **funciona** — es manual por definición |
| **F2 nivel 2** | se encola |
| **F3** | **no hay CAE.** Existe régimen de contingencia, pero es operativamente incómodo. |

Que F1 sea el modo más robusto es una razón de peso para priorizarlo: el cliente que ya invirtió en
impresora fiscal obtiene el sistema **más** confiable, no el menos.

---

## 5. Seguridad de credenciales fiscales

- Certificado y clave **por tenant**, cifrados en reposo con clave maestra fuera de la base
  (KMS o `pgcrypto` con la clave en variable de entorno).
- **Nunca** en el cliente, nunca en el bundle, nunca en IndexedDB.
- La clave privada **no se loguea jamás**. Redacción en el logger, no confianza en el programador.
- Token WSAA cacheado del lado del servidor, con renovación anticipada y **una sola renovación en
  vuelo** (si dos requests lo piden a la vez, uno solo va al organismo).
- Cada intento fiscal se audita con request y response, sin secretos.

Este punto es la razón real por la que F3 es caro. Y es la razón por la que no se arranca por ahí.

---

## 6. Cobros: el mismo patrón, otra matriz

`CobroTerminal` con `capacidades()`. Cuatro clases de medio de pago:

| Clase | Ejemplos | Integración | Fase |
|---|---|---|---|
| **Efectivo** | — | ninguna | **v1. Siempre.** |
| **Registro manual** | tarjeta o QR cobrado en otro equipo, transferencia | ninguna | **v1** |
| **QR dinámico** | Mercado Pago, MODO, billeteras (QR interoperable) | un PSP | v2 |
| **Terminal física integrada** | MP Point, Posnet/Lapos, Clover | protocolo local + homologación | v3 |

**V1 cubre dos de estas cuatro sin escribir una línea de integración.** Y cubre el 100% del volumen
real de un kiosco de barrio: efectivo y "cobré con la tarjeta, lo paso después". Un kiosco hoy no
integra nada — ya opera así, con un cuaderno.

El **QR interoperable** simplifica mucho el panorama: un QR generado por un PSP puede cobrarse desde
cualquier billetera del cliente, así que **una integración de QR cubre casi todas las billeteras** en
lugar de una por billetera. Verificado: Transferencias 3.0 con QR interoperable está en pleno
funcionamiento desde 2021 y desde 2023 los comercios que exhiben QR para tarjetas **deben** aceptar
pagos desde cualquier billetera, sin importar la marca del QR ([`bcra.gob.ar`]).

Ojo con el organismo: **el QR es regulación del BCRA, no de ARCA.** Son dos universos distintos y se
negocian con interlocutores distintos.

Terminal física es lo más caro (homologación por proveedor, puente local, modo offline del posnet) y lo
que menos mueve la aguja para vender. Va último, y sólo si un cliente lo pide.

---

## 7. Roadmap de estas dos piezas

| Fase | Fiscal | Cobros |
|---|---|---|
| **M1** (demo) | F0 — ticket interno | efectivo + registro manual |
| **M2** (sync + API) | F0, con el **outbox fiscal ya construido y vacío** | idem |
| **M3** (piloto) | F1 si el kiosco piloto tiene controlador fiscal | + QR dinámico |
| **M4** | F2 nivel 1 | terminal integrada, si hay demanda |
| **M5+** | F3 (WSFE nativo) | más PSPs |

**Nota importante:** la estructura del outbox fiscal se construye en M2 *aunque esté vacía*. Agregarla
después implica tocar el camino de la venta, que es la única cosa que no querés tocar cuando ya hay
clientes cobrando.

---

## 8. Preguntas para el contador (una hora, y te ahorra meses)

No son opcionales: acá hay exposición legal y yo no soy tu asesor impositivo.

1. Un kiosco monotributista, ¿está obligado a emitir comprobante por **cada** venta al consumidor final?
   ¿Desde qué monto?
2. Si AlToke imprime un ticket con el logo del kiosco, ¿qué leyenda es **obligatoria** para que no
   parezca una factura?
3. Para un Responsable Inscripto con controlador fiscal homologado: ¿AlToke puede convivir con la
   impresora fiscal y no emitir nada por su lado?
4. Si una venta se cobra y el CAE falla, ¿cuál es el plazo y la forma de regularizarla?
5. El punto de venta para WSFE, ¿lo habilita el cliente o lo gestiona AlToke?
6. Si el cliente es una **tienda** (no kiosco) con más volumen, ¿cambia el régimen?

---

## 9. Lo que AlToke no va a hacer nunca

Decidirlo ahora evita discusiones caras después:

- Asesoría contable o impositiva. Es una herramienta.
- Guardar la memoria fiscal del cliente. Esa es de la impresora o del organismo.
- Prometer un comprobante fiscal emitido desde el navegador sin almacenamiento local cifrado.
- Reemplazar al contador del cliente. Se integra o se acompaña.
- Inventar numeración de comprobante por ningún motivo.

---

## 10. Estado de la verificación

### Confirmado contra fuente oficial

| Punto | Resultado | Fuente |
|---|---|---|
| Nombre del organismo | **ARCA** (Agencia de Recaudación y Control Aduanero), ex AFIP | `arca.gob.ar` |
| Obligación de emitir | alcanza a RI, exentos **y monotributistas** | `arca.gob.ar/fe/emision-autorizacion/sujetos.asp` |
| Modalidades | controlador fiscal **y/o** factura electrónica, **opcionales y combinables** | `arca.gob.ar/facturacion/comprobantes/fe-vs-cf.asp` |
| Monotributo | **siempre Factura C**, sin discriminar IVA, a cualquier cliente | `arca.gob.ar/facturacion/monotributo/comprobantes.asp` |
| QR interoperable | operativo desde 2021; aceptación obligatoria desde 2023 · **regulado por BCRA** | `bcra.gob.ar` |
| Tendencia | la obligación de facturar electrónicamente **se está ampliando** | novedades ARCA |

### Pendiente antes de implementar F1 o F3

- [ ] Si `WSFEv1` sigue siendo el web service vigente o tiene sucesor.
- [ ] Tabla oficial de alícuotas y códigos de comprobante.
- [ ] Modelos de controlador fiscal homologados y su protocolo.
- [ ] Leyendas obligatorias del ticket no fiscal (→ contador, §8).

Ninguno cambia las decisiones de arquitectura: todas son de **forma**, no de contenido legal. Pero sí
cambian textos de UI, códigos y el onboarding.
