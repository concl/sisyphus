import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadRuntimeExtensions } from './extensions/loader'
import spriteRaw from './assets/icons.svg?raw'

// Inline the icon sprite into the document so `<use href="#icon-...">` works
// even when the app is loaded from file:// (external SVG <use> references are
// CORS-blocked for file:// pages, so they render nothing).
const spriteHost = document.createElement('div')
spriteHost.id = 'icons-sprite'
spriteHost.style.display = 'none'
spriteHost.innerHTML = spriteRaw
document.body.appendChild(spriteHost)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Load runtime extensions (userData store) after first paint; their pages
// register into the dynamic registry that App reads.
loadRuntimeExtensions()
