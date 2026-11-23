import type { SobreventasPorVenta } from '@altoke/domain'

export interface AvisoSobreventasProps {
  readonly alertas: SobreventasPorVenta
}

/**
 * Las sobreventas que el servidor proyectó (`0003` §Sobreventa): la mercadería salió, el libro lo
 * sabe y el cajero tiene que verlo. Es un banner en el flujo de la pantalla, no un modal: se lee y
 * se sigue cobrando.
 */
export function AvisoSobreventas({ alertas }: AvisoSobreventasProps) {
  const filas = Object.entries(alertas).flatMap(([ventaId, porSku]) =>
    Object.values(porSku).map((alerta) => ({ ...alerta, ventaId })),
  )

  if (filas.length === 0) return null

  return (
    <aside
      role="status"
      aria-label="Sobreventas detectadas"
      aria-live="polite"
      className="mx-[var(--page-margin)] mt-[var(--space-sm)] rounded-md border border-destructive bg-danger-soft px-[var(--space-md)] py-[var(--space-sm)] text-sm leading-5 text-danger-soft-foreground"
    >
      <p className="font-semibold">Sobreventa detectada: el stock quedó bajo cero.</p>
      <ul className="mt-[var(--space-xs)] grid gap-[var(--space-xs)]">
        {filas.map((alerta) => (
          <li key={`${alerta.ventaId}:${alerta.sku}`}>
            <strong>{alerta.sku}</strong>: quedan {alerta.stockProyectado} (se vendieron{' '}
            {alerta.cantidad} en la venta {alerta.ventaId}).
          </li>
        ))}
      </ul>
      <p className="mt-[var(--space-xs)] text-xs">
        El aviso no bloquea el cobro: la venta ya salió y el papel no miente.
      </p>
    </aside>
  )
}
