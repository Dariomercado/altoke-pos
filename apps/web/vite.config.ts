import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// SPA sin SSR (`0001` §5): el POS tiene que seguir cobrando cuando la API no responde.
export default defineConfig({
  plugins: [react()],
})
