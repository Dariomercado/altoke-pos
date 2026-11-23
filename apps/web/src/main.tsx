import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
