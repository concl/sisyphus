import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built app works when loaded via file://
  // from the Electron main process (win.loadFile).
  base: './',
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  css: {
    modules: {
      // Kebab-case class names in *.module.css are exported to JS as
      // camelCase keys (styles.tabStrip), which is what the components use.
      localsConvention: 'camelCaseOnly',
    },
  },
})
