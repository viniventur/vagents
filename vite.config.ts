import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// O Tauri abre a janela no devUrl de src-tauri/tauri.conf.json: a porta é fixa.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    // O WebView2 é o Chromium do Windows 11: dá para mirar alto.
    target: 'chrome120',
  },
})
