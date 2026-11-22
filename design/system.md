# AlToke — design system

Sincronizado desde el código, no inventado. Fuente única: `packages/ui/src/tokens.css`
(CSS custom properties). No hay design system en Figma, ni config de Tailwind, ni
librería de componentes: los componentes son `.tsx` escritos a mano en
`apps/web/src/components/` con CSS en `apps/web/src/styles/pos.css`.

Convención: los artboards de `design/<slug>/` usan **sólo** estos tokens y stacks de
fuente de sistema. El POS arranca sin internet: nada de CDN, fuentes remotas ni
imágenes externas.

## Temas

`data-theme="light"` (por defecto) y `data-theme="dark"`. Ambos sobre `:root`.
`color-scheme` se declara en cada tema para que los controles nativos acompañen.

## Marca del tenant

Cinco huecos, y nada más es configurable. Todo lo demás se deriva de ellos y del tema.

| Token | Claro | Oscuro |
| --- | --- | --- |
| `--brand-primary` | `#4d44e3` | `#c3c0ff` |
| `--brand-accent` | `#005049` | `#6bd8cb` |
| `--brand-surface` | `#fbf8ff` | `#0b1326` |
| `--brand-text` | `#1b1b21` | `#dae2fd` |
| `--brand-logo` | `none` | `none` |

Restricción vigente: la marca sólo admite fondos claros, porque los contenedores del
tema claro no derivan de `--brand-surface`. Una marca oscura se rechaza con el ratio
medido (guard de contraste, `apps/web/src/marca.ts`).

## Tipografía

Stacks declarados con fallback de sistema; **no se importan desde un CDN**.

| Token | Valor |
| --- | --- |
| `--font-sans` | `'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-ui` | `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-variant-numeric` | `tabular-nums` |

### Escala

| Estilo | Tamaño | Interlínea | Tracking / peso |
| --- | --- | --- | --- |
| `--text-display-lg` | `3rem` | `--leading-display-lg: 3.5rem` | `-0.03em` / `700` |
| `--text-headline-lg` | `2rem` | `--leading-headline-lg: 2.5rem` | `-0.02em` / `700` |
| `--text-headline-lg-mobile` | `1.5rem` | `--leading-headline-lg-mobile: 2rem` | `-0.02em` / `700` |
| `--text-headline-md` | `1.5rem` | `--leading-headline-md: 2rem` | `-0.015em` / `600` |
| `--text-headline-sm` | `1.25rem` | `--leading-headline-sm: 1.75rem` | `-0.01em` / `600` |
| `--text-body-lg` | `1.125rem` | `--leading-body-lg: 1.75rem` | `400` |
| `--text-body-md` | `0.9375rem` | `--leading-body-md: 1.5rem` | `400` |
| `--text-body-sm` | `0.8125rem` | `--leading-body-sm: 1.25rem` | `400` |
| `--text-label-lg` | `0.875rem` | `--leading-label-lg: 1.25rem` | `0.01em` / `600` |
| `--text-label-md` | `0.75rem` | `--leading-label-md: 1rem` | `0.02em` / `600` |
| `--text-label-sm` | `0.6875rem` | `--leading-label-sm: 0.875rem` | `0.04em` / `700` |
| `--text-data-pos` | `1.75rem` | `--leading-data-pos: 2rem` | `-0.02em` / `700` |

`--text-data-pos` es el estilo de los números del POS (totales, cantidades, vuelto).
Siempre con `font-variant-numeric: tabular-nums` para que las cifras no bailen al
actualizarse.

## Espaciado

| Token | Valor |
| --- | --- |
| `--space-xs` | `0.25rem` |
| `--space-sm` | `0.5rem` |
| `--space-md` | `1rem` |
| `--space-lg` | `1.5rem` |
| `--space-xl` | `2.5rem` |
| `--gutter` | `1rem` |
| `--gutter-desktop` | `1.5rem` |
| `--page-margin` | `1rem` |
| `--page-margin-tablet` | `1.5rem` |
| `--page-margin-desktop` | `2rem` |

## Radios

| Token | Valor |
| --- | --- |
| `--radius-xs` | `0.125rem` |
| `--radius-sm` | `0.25rem` |
| `--radius-md` | `0.5rem` |
| `--radius-lg` | `0.75rem` |
| `--radius-full` | `9999px` |

Escala deliberadamente corta: el POS se usa con guantes y a las apuradas; los radios
grandes leen como juguete en una pantalla táctil sucia.

## Medidas táctiles

El POS se usa de pie, con una mano.

| Token | Valor |
| --- | --- |
| `--size-touch-min` | `2.75rem` (44 px, mínimo de target) |
| `--size-control` | `3rem` (48 px, control estándar) |
| `--size-header` | `4rem` |

## Elevación

| Token | Valor |
| --- | --- |
| `--shadow-panel` | `0 1px 8px rgb(0 0 0 / 4%)` |
| `--shadow-overlay` | `0 20px 25px -5px rgb(0 0 0 / 50%), 0 8px 10px -6px rgb(79 70 229 / 12%)` |
| `--focus-ring-width` | `2px` |

## Paleta clara

| Token | Valor |
| --- | --- |
| `--color-primary` | `var(--brand-primary)` |
| `--color-on-primary` | `var(--brand-on-primary, #ffffff)` |
| `--color-primary-container` | `#e2dfff` |
| `--color-on-primary-container` | `#0f0069` |
| `--color-secondary` | `var(--brand-accent)` |
| `--color-on-secondary` | `var(--brand-on-accent, #ffffff)` |
| `--color-secondary-container` | `#89f5e7` |
| `--color-on-secondary-container` | `#00201d` |
| `--color-tertiary` | `#005236` |
| `--color-on-tertiary` | `#ffffff` |
| `--color-tertiary-container` | `#6ffbbe` |
| `--color-on-tertiary-container` | `#002113` |
| `--color-error` | `#93000a` |
| `--color-on-error` | `#ffffff` |
| `--color-error-container` | `#ffdad6` |
| `--color-on-error-container` | `#690005` |
| `--color-surface` | `var(--brand-surface)` |
| `--color-surface-dim` | `#dad9e1` |
| `--color-surface-bright` | `#fbf8ff` |
| `--color-surface-container-lowest` | `#ffffff` |
| `--color-surface-container-low` | `#f5f2fa` |
| `--color-surface-container` | `#efecf4` |
| `--color-surface-container-high` | `#e9e7ee` |
| `--color-surface-container-highest` | `#e4e1e9` |
| `--color-on-surface` | `var(--brand-text)` |
| `--color-on-surface-variant` | `#464555` |
| `--color-outline` | `#777586` |
| `--color-outline-variant` | `#c7c4d8` |
| `--color-placeholder` | `var(--color-on-surface-variant)` |
| `--color-inverse-surface` | `#0b1326` |
| `--color-inverse-on-surface` | `#dae2fd` |

## Paleta oscura

| Token | Valor |
| --- | --- |
| `--color-primary` | `var(--brand-primary)` |
| `--color-on-primary` | `var(--brand-on-primary, #1d00a5)` |
| `--color-primary-container` | `#4f46e5` |
| `--color-on-primary-container` | `#dad7ff` |
| `--color-secondary` | `var(--brand-accent)` |
| `--color-on-secondary` | `var(--brand-on-accent, #003732)` |
| `--color-secondary-container` | `#29a195` |
| `--color-on-secondary-container` | `#00302b` |
| `--color-tertiary` | `#4edea3` |
| `--color-on-tertiary` | `#003824` |
| `--color-tertiary-container` | `#006e4b` |
| `--color-on-tertiary-container` | `#67f4b7` |
| `--color-error` | `#ffb4ab` |
| `--color-on-error` | `#690005` |
| `--color-error-container` | `#93000a` |
| `--color-on-error-container` | `#ffdad6` |
| `--color-surface` | `var(--brand-surface)` |
| `--color-surface-dim` | `#0b1326` |
| `--color-surface-bright` | `#31394d` |
| `--color-surface-container-lowest` | `#060e20` |
| `--color-surface-container-low` | `#131b2e` |
| `--color-surface-container` | `#171f33` |
| `--color-surface-container-high` | `#222a3d` |
| `--color-surface-container-highest` | `#2d3449` |
| `--color-on-surface` | `var(--brand-text)` |
| `--color-on-surface-variant` | `#c7c4d8` |
| `--color-outline` | `#918fa1` |
| `--color-outline-variant` | `#464555` |
| `--color-placeholder` | `var(--color-on-surface-variant)` |
| `--color-inverse-surface` | `#dae2fd` |
| `--color-inverse-on-surface` | `#283044` |

## Reglas de componente

- **Foco.** `:where(:focus-visible)` con `outline: 2px solid var(--color-primary)` y
  `outline-offset: 2px`. Nunca `outline: none` sin reemplazo.
- **Scrollbars.** Visibles y finas (`scrollbar-width: thin`,
  `--color-outline-variant`). El contrato de arquitectura (§7) prohíbe ocultarlas.
- **Placeholder.** `--color-placeholder` = `--color-on-surface-variant`, ≥ 4.5:1.
  Nunca `outline-variant` como color de texto.
- **Superficies.** La jerarquía se expresa con la escalera `surface-container-*`, de
  `lowest` (blanco) a `highest`. Un panel no lleva borde y sombra a la vez.
- **Radios.** Controles y tiles: `--radius-md`. Contenedores grandes:
  `--radius-lg`. Nada con `--radius-full` salvo chips y avatares.
- **Contraste.** Texto normal ≥ 4.5:1; texto grande ≥ 3:1; bordes que identifican
  un control ≥ 3:1. El estado nunca se comunica sólo por color.
- **Movimiento.** Sólo `transform` y `opacity`. 100–150 ms micro, 150–250 ms UI,
  250–300 ms overlays. `ease-out` para entrada, `ease-in-out` para movimiento en
  pantalla. Todo con su `@media (prefers-reduced-motion: reduce)`.
