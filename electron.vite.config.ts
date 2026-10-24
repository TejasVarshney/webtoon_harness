import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const alias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    build: {
      // A sandboxed preload cannot require() npm packages, so everything it imports is bundled.
      externalizeDeps: false
    }
  },
  renderer: {
    resolve: { alias },
    plugins: [react()]
  }
})
