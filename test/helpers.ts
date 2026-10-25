// Starts the real app on a random port for a suite
import './env.ts'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import createApp from '../src/app.ts'

/** The app listening on a random local port. */
export interface RunningServer {
  /** Base URL without a trailing slash, e.g. `http://127.0.0.1:41234`. */
  url: string
  /**
   * Stops the server.
   *
   * @returns {Promise<void>} Resolves once every connection is closed.
   */
  close (): Promise<void>
}

/**
 * Builds the app over the repository's data folder and listens on a random port.
 *
 * @returns {Promise<RunningServer>} The running server; call close() in afterAll.
 */
export async function startServer (): Promise<RunningServer> {
  const { app } = createApp()
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }
}

/** A parsed JSON response. */
export interface JsonResponse {
  /** HTTP status code. */
  status: number
  /** Response headers. */
  headers: Headers
  /** The parsed body. */
  body: unknown
}

/**
 * Sends a request and parses the JSON answer.
 *
 * @param {string} url - Full URL.
 * @param {RequestInit} [init] - fetch options (method, headers, body).
 * @returns {Promise<JsonResponse>} Status, headers and parsed body.
 * @throws {SyntaxError} When the answer is not JSON.
 */
export async function request (url: string, init?: RequestInit): Promise<JsonResponse> {
  const res = await fetch(url, init)
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: JSON.parse(text) as unknown }
}
