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
})
