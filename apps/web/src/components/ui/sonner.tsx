import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Toaster atado a los tokens de AlToke.
 *
 * El original de shadcn lee el tema con `next-themes`, que en esta app no existe:
 * el tema se cambia con `data-theme` en <html> (ver tokens.css). Además apuntaba
 * a `--popover`, `--border` y `--radius`, nombres que acá no están declarados.
 *
 * `theme` queda como prop explícita: sonner sólo lo usa para sus colores
 * internos, y los de acá se pisan por custom properties.
 */
function Toaster({ theme = 'light', ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--color-popover)',
          '--normal-text': 'var(--color-popover-foreground)',
          '--normal-border': 'var(--color-border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
