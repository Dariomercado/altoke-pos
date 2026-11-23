import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// SPA sin SSR (`0001` §5): el POS tiene que seguir cobrando cuando la API no responde.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Lo necesita shadcn/ui: sus componentes se importan como `@/components/ui/...`.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // En desarrollo la web llama a `/api/auth/sesion` en su propio origen y Vite lo reenvía al API
      // local. Sin esto, `baseUrlDesdeEntorno` tendría que apuntar a `http://localhost:3001` y cada
      // dev tendría que acordarse de `CORS_ORIGINS` — el 403 del navegador sin `Access-Control-`
      // `Allow-Origin` se ve igual que una red caída. Así `pnpm dev` funciona con la API recién
      // arrancada, en cualquier puerto.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        rewrite: (ruta) => ruta.replace(/^\/api/, ''),
        // El salto Vite→API no es un pedido de navegador: sin `Origin`, el CORS explícito del API
        // (que en producción sí aplica entre `slug.altoke.app` y `api.altoke.app`) no tiene por qué
        // intervenir. Sacarlo acá no relaja nada fuera de este proxy de desarrollo.
        configure: (proxy) => {
          proxy.on('proxyReq', (pedido) => pedido.removeHeader('origin'))
        },
      },
    },
  },
})
