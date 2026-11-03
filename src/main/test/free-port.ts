import http from 'node:http'

/**
 * The ports at or above 1024 that `fetch` (undici) refuses with "bad port" (the Fetch spec's list). Windows can
 * hand any of them out for port 0 when its dynamic range starts at 1024, so a test whose client uses fetch (the
 * MCP SDK's) must not end up on one.
 */
const FETCH_BAD_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080])

export const isFetchablePort = (port: number): boolean => !FETCH_BAD_PORTS.has(port)

/** Listens on port 0, again while the port it got is one fetch refuses; resolves with the port. */
export async function listenOnFetchablePort(server: { listen(port: number): Promise<void>; close(): Promise<void>; readonly port: number | null }): Promise<number> {
  for (;;) {
    await server.listen(0)
    const port = server.port!
    if (isFetchablePort(port)) return port
    await server.close()
  }
}

/** A port that is free right now and that fetch connects to. */
export async function freePort(): Promise<number> {
  for (;;) {
    const probe = http.createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
    const { port } = probe.address() as { port: number }
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    if (isFetchablePort(port)) return port
  }
}
