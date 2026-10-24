import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts']
        }
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/src/test/setup.ts']
        }
      }
    ]
  }
})
