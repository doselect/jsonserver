// src/index.ts as it runs on a server: the INFO lines it writes from start to a SIGTERM shutdown (startup, data
// file found and loaded, one access line per request with its data file, none for /health or /health/, the shutdown
// steps), SIGINT, malformed HTTP, and the CRITICAL exits at boot (data folder missing, port in use)
import { it } from 'vitest'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/** Repository root: the child process's working directory. */
const ROOT = path.join(import.meta.dirname, '..')

/** One parsed log line. */
type LogLine = Record<string, unknown>

/**
 * A TCP port that was free a moment ago.
 *
 * @returns {Promise<number>} The port number.
 */
function freePort (): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

/** A src/index.ts child process and what it has written. */
interface Server {
  /** The process. */
  child: ChildProcessWithoutNullStreams
  /** Base URL, e.g. `http://127.0.0.1:41234`. */
  base: string
  /** Port it was told to listen on. */
  port: number
  /** Resolves with the exit code. */
  exited: Promise<number | null>
  /**
   * The log lines written to stdout so far.
   *
   * @returns {LogLine[]} Parsed lines, in order.
   */
  lines (): LogLine[]
  /**
   * Waits until a line with this message has been written.
   *
   * @param {string} message - The exact `message`.
   * @returns {Promise<void>} Resolves once it appears.
   */
  waitFor (message: string): Promise<void>
}

/**
 * Starts src/index.ts with stdout logging on a free port (or the one in `env`).
 *
 * @param {Record<string, string>} [env] - Extra environment for the child.
 * @returns {Promise<Server>} The running (or failing) server.
 */
async function startServer (env: Record<string, string> = {}): Promise<Server> {
  const port = env.PORT ? Number(env.PORT) : await freePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.ts')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), LOG_STDOUT: 'true', ...env }
  })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  const lines = (): LogLine[] => stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as LogLine)
  return {
    child,
    base: `http://127.0.0.1:${port}`,
    port,
    exited: new Promise((resolve) => child.on('exit', resolve)),
    lines,
    async waitFor (message) {
      while (!lines().some((line) => line.message === message)) await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

it('logs startup, data loading, one access line per request and a clean shutdown', async () => {
  const { child, base, port, exited, lines, waitFor } = await startServer()
  await waitFor('Json server started.')
  await (await fetch(`${base}/api/notes/1`, { headers: { 'X-Request-Id': 'req-7' } })).text()
  await (await fetch(`${base}/api/notes`)).text()
  await (await fetch(`${base}/health`)).text()
  await (await fetch(`${base}/health/`)).text()
  child.kill('SIGTERM')
  assert.equal(await exited, 0)

  const all = lines()
  assert.deepEqual(all.map((line) => line.message), [
    'Found the data files to serve.',
    'Json server started.',
    'Loaded the data file into memory.',
    'Request completed.',
    'Request completed.',
    'Received shutdown signal and stopped accepting connections.',
    'Completed graceful shutdown.'
  ])
  const [found, started, loaded, first, second, shutdown] = all
  assert.equal(found?.data_file_count, 9)
  assert.equal(started?.port, port)
  assert.equal(started?.module, 'index')
  assert.equal(started?.log_level, 'info')
  assert.equal(typeof started?.version, 'string')
  assert.deepEqual(loaded?.resources, ['notes'])
  assert.equal(loaded?.records, 50)
  assert.equal(loaded?.request_id, 'req-7', 'loading happens inside the first request and carries its id')
  assert.equal(first?.request_id, 'req-7')
  assert.equal(first?.endpoint, '/api/notes/1')
  assert.equal(first?.data_file, 'notes')
  assert.equal(first?.status_code, 200)
  assert.equal(typeof first?.response_time_ms, 'number')
  assert.match(String(second?.request_id), /^[0-9a-f-]{36}$/, 'a generated id when the client sends none')
  assert.notEqual(second?.request_id, first?.request_id)
  assert.equal(shutdown?.signal, 'SIGTERM')
})

it('logs the data file and status of failed requests too', async () => {
  const { child, base, exited, lines, waitFor } = await startServer()
  await waitFor('Json server started.')
  await (await fetch(`${base}/api/nope`)).text()
  await (await fetch(`${base}/api/notes?title_like=${'a'.repeat(101)}`)).text()
  child.kill('SIGTERM')
  await exited

  const all = lines()
  const missing = all.find((line) => line.message === 'Received a request for a data file that does not exist.')
  assert.equal(missing?.data_file, 'nope')
  const rejected = all.find((line) => line.message === 'Rejected a partial match query that is repeated or too long.')
  assert.equal(rejected?.query_param, 'title_like')
  const access = all.filter((line) => line.message === 'Request completed.')
  assert.deepEqual(access.map((line) => [line.data_file, line.status_code]), [['nope', 404], [undefined, 400]])
})

it('shuts down cleanly on SIGINT as well', async () => {
  const { child, exited, lines, waitFor } = await startServer()
  await waitFor('Json server started.')
  child.kill('SIGINT')
  assert.equal(await exited, 0)
  assert.equal(lines().find((line) => line.message === 'Received shutdown signal and stopped accepting connections.')?.signal, 'SIGINT')
})

it('answers malformed HTTP with 400 and keeps serving', async () => {
  const { child, base, port, exited, waitFor } = await startServer()
  await waitFor('Json server started.')
  const reply = await new Promise<string>((resolve) => {
    let data = ''
    const socket = net.connect(port, '127.0.0.1', () => socket.write('NOT A REQUEST\r\n\r\n'))
    socket.on('data', (chunk) => { data += chunk.toString() })
    socket.on('close', () => resolve(data))
  })
  assert.match(reply, /^HTTP\/1\.1 400 Bad Request/)
  assert.equal((await fetch(`${base}/health`)).status, 200)
  child.kill('SIGTERM')
  assert.equal(await exited, 0)
})

it('exits 1 with a CRITICAL line when the data folder is missing', async () => {
  const { exited, lines } = await startServer({ DATA_DIRECTORY: path.join(ROOT, 'does-not-exist') })
  assert.equal(await exited, 1)
  const [line] = lines()
  assert.equal(line?.levelname, 'CRITICAL')
  assert.equal(line?.message, 'Failed to read the data folder.')
  assert.equal(line?.error_code, 'ENOENT')
})

it('exits 1 with a CRITICAL line when the port is taken', async () => {
  const blocker = net.createServer()
  await new Promise<void>((resolve) => blocker.listen(0, resolve))
  const { port } = blocker.address() as net.AddressInfo
  try {
    const { exited, lines } = await startServer({ PORT: String(port) })
    assert.equal(await exited, 1)
    const critical = lines().find((line) => line.levelname === 'CRITICAL')
    assert.equal(critical?.message, 'Failed to start the HTTP server.')
    assert.equal(critical?.error_code, 'EADDRINUSE')
  } finally {
    blocker.close()
  }
})
