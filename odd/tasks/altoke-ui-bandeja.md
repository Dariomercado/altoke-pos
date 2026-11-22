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

- **T1** Tailwind v4 + mapeo de tokens a `@theme`, marca incluida. → S4, S6
- **T2** Base shadcn/ui: primitivos instalados y apuntados a los tokens (no a su paleta default). → S2, S4
- **T3** Guard de marca y tests de contraste funcionando sobre las superficies nuevas. → S4, S6
- **T4** Pantalla de venta (riel, tiles, bandeja). → S1, S3, S6
- **T5** Hoja de cobro (medio de pago, billetes rápidos, vuelto, bloqueo con razón). → S1, S3
- **T6** Pantalla de ticket post-cobro, con las reglas de 80 mm intactas. → S3
- **T7** Pantalla de cierre de caja (arqueo por denominación, veredicto, faltante/sobrante/cuadrado). → S1, S3
- **T8** Movimiento con Motion en los tres momentos definidos, con `prefers-reduced-motion`. → S2, S5
- **T9** Verificación: suite completa, typecheck, lint, build, y revisión visual contra artboards. → S1

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
