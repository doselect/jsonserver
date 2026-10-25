// src/index.ts as it runs on a server: the INFO lines it writes from start to a SIGTERM shutdown (startup, data
// file found and loaded, one access line per request with its data file, none for /health or /health/, the shutdown
// steps)
import { it } from 'vitest'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'

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

it('logs startup, data loading, one access line per request and a clean shutdown', async () => {
  const port = await freePort()
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.ts')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), LOG_STDOUT: 'true' }
  })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))

  while (!stdout.includes('Json server started.')) await new Promise((resolve) => setTimeout(resolve, 20))
  const base = `http://127.0.0.1:${port}`
  await (await fetch(`${base}/api/notes/1`, { headers: { 'X-Request-Id': 'req-7' } })).text()
  await (await fetch(`${base}/api/notes`)).text()
  await (await fetch(`${base}/health`)).text()
  await (await fetch(`${base}/health/`)).text()
  child.kill('SIGTERM')
  assert.equal(await exited, 0)

  const lines = stdout.trim().split('\n').map((line) => JSON.parse(line) as LogLine)
  const messages = lines.map((line) => line.message)
  assert.deepEqual(messages, [
    'Found the data files to serve.',
    'Json server started.',
    'Loaded the data file into memory.',
    'Request completed.',
    'Request completed.',
    'Received shutdown signal and stopped accepting connections.',
    'Completed graceful shutdown.'
  ])
  const [found, started, loaded, first] = lines
  assert.equal(found?.data_file_count, 9)
  assert.equal(started?.port, port)
  assert.equal(started?.module, 'index')
  assert.deepEqual(loaded?.resources, ['notes'])
  assert.equal(loaded?.records, 50)
  assert.equal(loaded?.request_id, 'req-7', 'loading happens inside the first request and carries its id')
  assert.equal(first?.request_id, 'req-7')
  assert.equal(first?.endpoint, '/api/notes/1')
  assert.equal(first?.data_file, 'notes')
  assert.equal(first?.status_code, 200)
  assert.equal(typeof first?.response_time_ms, 'number')
})
