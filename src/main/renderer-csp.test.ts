import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'
import { describe, expect, it } from 'vitest'

// I3: the renderer's CSP (`script-src 'self'`, a <meta> in index.html) does not block the inline React Refresh
// preamble that @vitejs/plugin-react injects in `npm run dev`, because Vite puts that script at the top of <head>,
// before the <meta>, and a <meta> policy only governs what comes after it. Verified by running `npm run dev`: the
// renderer mounts with no "can't detect preamble" error and no CSP violation. This test keeps that order, so the
// production policy never needs a dev-only 'unsafe-inline'.

const htmlFile = path.resolve('src/renderer/index.html')

describe('renderer Content-Security-Policy', () => {
  it('stays strict: scripts only from the app itself', () => {
    const html = fs.readFileSync(htmlFile, 'utf8')
    const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1]
    const directives = Object.fromEntries((csp ?? '').split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]))
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['default-src']).toEqual(["'self'"])
  })

  it('lets the dev server put the React Refresh preamble ahead of the policy', async () => {
    const server = await createServer({
      configFile: false,
      root: path.dirname(htmlFile),
      plugins: [react()],
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] }
    })
    try {
      const html = await server.transformIndexHtml('/', fs.readFileSync(htmlFile, 'utf8'))
      const preamble = html.indexOf('injectIntoGlobalHook')
      const policy = html.indexOf('Content-Security-Policy')
      expect(preamble).toBeGreaterThan(-1)
      expect(policy).toBeGreaterThan(-1)
      expect(preamble).toBeLessThan(policy)
    } finally {
      await server.close()
    }
  })
})
