import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadRuntimeExtensions } from './extensions/loader'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Load runtime extensions (userData store) after first paint; their pages
// register into the dynamic registry that App reads.
loadRuntimeExtensions()
