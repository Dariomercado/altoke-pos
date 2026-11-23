# AlToke — UI bandeja táctil sobre Tailwind v4 + shadcn/ui

Rediseño del flujo de venta y cierre del POS. Dirección elegida: **bandeja táctil**
(`design/pos-kiosco/02`, `06`, `07`, `04`). Base de estilos elegida: **Tailwind v4 + shadcn/ui**.
Sin cambios de lógica de dominio, de persistencia ni del contrato fiscal: esto es piel, movimiento y
estructura de pantalla.

## Specs

**S1.** El rediseño tiene que ser visualmente mejor sin volverse ruidoso:

> "hay que hacer un diseño mas bonito, obvio que la interfaz debe ser intuitiva y sin tanta visual que
> distraiga pero lo que tenemos ahora es muy plano."

**S2.** Se incorporan skills de diseño y la librería de componentes:

> "podriamos agregar una skill de diseño en el proyecto, sacar alguna skill de skills.sh de vercel,
> podriamos usar shadcn tambien, y agregar algunas animaciones o motions"

**S3.** La dirección es bandeja táctil, y el flujo incluye el ticket:

> "vamos con bandeja tactil, la bandeja tactil no tiene ticket?"

El ticket de 80 mm es parte del producto (T7) y no se elimina: el flujo es venta → cobro → ticket →
cierre.

**S4.** Base de estilos: Tailwind v4 + shadcn/ui, elegida por el humano contra los artboards.

**S5.** Movimiento con la librería Motion (framer-motion), elegida por el humano. El peso se mide sobre
el hardware del kiosco antes de darlo por bueno; si degrada, se cae a CSS.

**S6.** Los artboards son el contrato visual: `design/pos-kiosco/` y `design/system.md` mandan sobre
color, escala, radios, medidas táctiles y estados. Cualquier desvío se corrige en el artboard o en el
código, pero no se decide de nuevo.

## Invariantes que el rediseño no puede romper

- **Marca del tenant (T8).** Los cinco huecos `--brand-primary/accent/surface/text/logo` siguen
  mandando. El guard de contraste sigue rechazando marcas ilegibles sobre los contenedores del tema
  claro. Si el mapeo a `@theme` de Tailwind deja alguna superficie fuera, el guard queda decorativo.
- **Ticket de 80 mm (T7).** `@page 80mm`, 72 mm útiles, leyenda "TICKET INTERNO — no es comprobante
  fiscal válido". El rediseño de pantalla no toca las reglas de impresión.
- **Foco visible.** `:focus-visible` con `outline` de marca; ningún `outline: none` sin reemplazo.
- **Scrollbars visibles.** El contrato de arquitectura (§7) las prohíbe ocultas.
- **Contraste.** Texto normal ≥ 4.5:1, grande ≥ 3:1, y el estado nunca se comunica sólo por color.
- **Offline.** Sin fuentes remotas, sin CDN, sin imágenes externas. Arranca sin internet.

## Tasks

- **T1** Tailwind v4 + mapeo de tokens a `@theme`, marca incluida. → S4, S6 · `0214d09`
- **T2** Base shadcn/ui: primitivos instalados y apuntados a los tokens (no a su paleta default). → S2, S4 · `5985f32`
- **T3** Guard de marca y tests de contraste funcionando sobre las superficies nuevas. → S4, S6 · `5985f32`
- **T4** Pantalla de venta (riel, tiles, bandeja). → S1, S3, S6 · `15c6d47`
- **T5** Hoja de cobro (medio de pago, billetes rápidos, vuelto, bloqueo con razón). → S1, S3 · `78ec884`
- **T6** Pantalla de ticket post-cobro, con las reglas de 80 mm intactas. → S3 · `9ebb511`
- **T7** Pantalla de cierre de caja (arqueo por denominación, veredicto, faltante/sobrante/cuadrado). → S1, S3 · `3f57101`
- **T8** Movimiento con Motion en los tres momentos definidos, con `prefers-reduced-motion`. → S2, S5 · `5dc86dd`
- **T9** Verificación: suite completa, typecheck, lint, build, y revisión visual contra artboards. → S1 · `5ae8186`

## Log

### L1 — Pedido original del rediseño

> "retomamos, en que nos quedamos? ejecute pnpm --filter @altoke/web dev en otra terminal y vi el
> sitio y probe el flujo de venta y cierre de caja funciona pero el diseño se ve muy basico, me
> dijiste que viera el sitio para que pruebe el flujo o para que vea el diseño tambien? hay que hacer
> un diseño mas bonito, obvio que la interfaz debe ser intuitiva y sin tanta visual que distraiga pero
> lo que tenemos ahora es muy plano. podriamos agregar una skill de diseño en el proyecto, sacar
> alguna skill de skills.sh de vercel, podriamos usar shadcn tambien, y agregar algunas animaciones o
> motions"

Aclaración registrada: el `dev` server servía para verificar T7/T8 en un navegador real, no para
revisar estética. M1 nunca tuvo pasada de diseño.

### L2 — Dirección elegida y hueco detectado

> "vamos con bandeja tactil, la bandeja tactil no tiene ticket?"

Se cierra el hueco con dos artboards nuevos: `06-cobro-bandeja.html` y `07-ticket-80mm.html`. El
ticket no se elimina; el artboard original sólo terminaba en COBRAR.

### L3 — Base de estilos

Tailwind v4 + shadcn/ui, elegido por el humano contra los artboards, con el costo anotado: hay que
remapear los cinco huecos de marca a `@theme` y desarmar la estética default de admin de escritorio.

### L4 — El peso de Motion, medido y decidido

T8 llegó con la condición de S5 sin cumplir: faltaba el número. Medido sobre `@altoke/web` en build de
producción, Motion cuesta **+143 kB sin comprimir / +47,6 kB gzip de JS** (313,85 → 457,14 kB raw;
99,12 → 146,58 kB gzip). Con ese número sobre la mesa el humano eligió **quedarse con la librería**
en vez de reescribir los tres momentos en CSS, que habría vuelto a ~99 kB. Queda anotado como costo
aceptado, no como descuido.

### L5 — Los tres momentos (T8)

`apps/web/src/movimiento.ts` es el único lugar donde se decide movimiento:

- **M1** entrar a la venta: la bandeja entra 12 px desde abajo (220 ms, `ease-out`).
- **M2** el vuelto responde: micro-pulso de la cifra cuando cambia el monto (150 ms). La `key` sobre el
  monto es el disparador, así que no hay estado escondido que comparar.
- **M3** el resultado aparece: ticket y veredicto del arqueo entran al confirmar (280 ms).

Con `prefers-reduced-motion` las tres devuelven `initial: false` (arrancar en el estado final): mismo
árbol, cero coreografía, no hay una segunda versión de la pantalla.

### L6 — Revisión visual real (T9)

El POS se miró renderizado a 1280×800, no sólo por tests. Los "ojos" son el Chromium cacheado de
Playwright conducido por CDP con un script en `/tmp` (Node 24 trae `WebSocket` global), así que no se
agregó ninguna dependencia para mirar. Tres defectos que la suite no podía ver y ahora están
corregidos en `5ae8186`:

- El wrapper de la bandeja era un bloque de `100dvh`, así que la grilla de venta se dimensionaba por
  contenido y dejaba una franja debajo de COBRAR. Ahora es una grilla de una fila.
- El contenedor de marca/último cierre se renderizaba vacío pero con padding de página, empujando la
  página 40 px más abajo del viewport. Ahora no existe hasta tener algo adentro.
- En la pantalla del ticket el bloque de vuelto se estiraba a todo el ancho y las acciones quedaban
  pegadas al resumen; ahora el bloque mide su contenido y las acciones cierran la pantalla abajo.

La impresión se verificó emulando `media: print`: sale **sólo** el ticket, anclado arriba a la
izquierda y sin el corrimiento que produciría la capa `fixed` sin la regla de `ticket.css`. El
`printToPDF` de Chromium sigue devolviendo Letter porque no soporta `size: 80mm auto`; el tamaño de
papel lo fija la impresora térmica, y el contrato CSS (72 mm útiles + leyenda) no cambió.

### L7 — Verificación independiente (T9)

Pasada de `gentle-ai-verify` sobre `78ec884..5ae8186` (lectura del código, no de los nombres de los
tests), con los cuatro comandos corridos en una copia scratch: typecheck, 202 tests, lint y build en
verde, y los invariantes medidos de verdad (contraste con el helper de `@altoke/ui`, foco calculado,
`media: print` emulado, `prefers-reduced-motion` observado en Chromium).

Levantó tres huecos de test y un hueco de contraste, cerrados en `9eba372`:

- `movimiento.test.ts` llamaba a los helpers con un `false` literal: el cableado de `useMovimiento`
  nunca se probaba. Ahora hay una sonda con `matchMedia` stubbeado.
- El test de pago insuficiente no afirmaba el `disabled` del botón de confirmar.
- El contrato de impresión no tenía ningún guard. Ahora está pinneado como texto, con chequeo de que
  cada `?raw` no llegue vacío.
- "Vaciar conteo" pintaba `--brand-primary` como tinta, y el guard de contraste no valida la marca
  como color de texto: una marca pastel lo dejaba ilegible. Ahora usa la tinta del tema.

Quedan anotados como follow-ups, fuera de este slice: el error de la caja se dibuja debajo del
scrim cuando la hoja está abierta (el `role=alert` igual anuncia); `PanelCierre` no deshabilita
Confirmar ante un error de la caja (reintentar es lo correcto, pero el test sólo afirma el texto del
alert); y dos detalles de T2 en `components/ui/button.tsx` (`ring-ring/50` a 2,32:1 sobre blanco, y
`text-ink` apuntando a una utilidad que no existe en la variante `secondary` que nadie usa).

## Forma de entrega

La rama `feat/ui-bandeja` acumula 12.798 líneas escritas en 26 commits: no entra en una review sola.
La forma propuesta —decisión del humano, igual que el push y el PR— es encadenar por slices ya
commiteados: (1) `0214d09..5985f32` tokens + shadcn + guard, (2) `15c6d47..78ec884` venta + hoja de
cobro, (3) `3f57101` cierre de caja, (4) `9ebb511` pantalla del ticket, (5) `5dc86dd..9eba372`
movimiento + verificación.
