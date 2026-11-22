import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Orden obligatorio: tailwind.css primero (trae preflight y el @theme), después
// los tokens del sistema compartido, que ganan ante cualquier colisión de :root.
import './styles/tailwind.css'
import '@altoke/ui/tokens.css'
import './styles/pos.css'
import './styles/ticket.css'
import { App } from './App'

const raiz = document.getElementById('raiz')

if (raiz === null) {
  throw new Error('Falta el nodo #raiz en index.html')
}

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
