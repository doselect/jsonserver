// The HTTP API against the real data folder: routes, json-server features, writes that are never saved, and the
// guards (unknown files, path tricks, _like patterns, JSONP, body size, error bodies without stack traces).
// Mirrors the flows in QA_GUIDE.md
import { afterAll, beforeAll, describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { request, startServer, type RunningServer } from './helpers.ts'

let server: RunningServer

beforeAll(async () => {
  server = await startServer()
})

afterAll(async () => {
  await server.close()
})

/** A note record. */
interface Note { id: number, title: string, description: string }

describe('health', () => {
  it('answers { status: Ok } on / and /health', async () => {
    for (const path of ['/', '/health']) {
      const res = await request(server.url + path)
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { status: 'Ok' })
    }
  })

  it('does not say it runs on Express, and returns a request id', async () => {
    const res = await request(`${server.url}/health`, { headers: { 'X-Request-Id': 'req-42' } })
    assert.equal(res.headers.get('x-powered-by'), null)
    assert.equal(res.headers.get('x-request-id'), 'req-42')
    assert.match((await request(`${server.url}/health`)).headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/)
  })
})

describe('reading data', () => {
  it('lists a file on /api/<file>, /api/<file>/<file> and /json/<file>/<file>', async () => {
    for (const path of ['/api/notes', '/api/notes/notes', '/json/notes/notes']) {
      const res = await request(server.url + path)
      assert.equal(res.status, 200, path)
      assert.equal((res.body as Note[]).length, 50, path)
    }
  })

  it('gets a record by id', async () => {
    const res = await request(`${server.url}/api/notes/1`)
    assert.equal(res.status, 200)
    assert.equal((res.body as Note).title, 'Learn node.js')
    assert.equal((await request(`${server.url}/api/notes/notes/1`)).status, 200)
  })

  it('filters, matches partially, sorts and pages', async () => {
    const like = await request(`${server.url}/api/notes?title_like=Learn`)
    assert.deepEqual((like.body as Note[]).map((note) => note.id), [1, 17, 26, 31, 38, 46])

    const paged = await request(`${server.url}/api/notes?title_like=Learn&_sort=id&_order=desc&_limit=2`)
    assert.deepEqual((paged.body as Note[]).map((note) => note.id), [46, 38])

    const exact = await request(`${server.url}/api/notes?id=2`)
    assert.deepEqual((exact.body as Note[]).map((note) => note.title), ['Buy fruits'])
  })

  it('matches _like values as plain text, not as a regular expression', async () => {
    const res = await request(`${server.url}/api/notes?title_like=${encodeURIComponent('Learn.*')}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, [])
  })
})

describe('writing data', () => {
  it('answers a write like a real API but never saves it', async () => {
    const created = await request(`${server.url}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New note', description: 'Not saved' })
    })
    assert.equal(created.status, 201)
    assert.equal((created.body as Note).id, 51)

    const deleted = await fetch(`${server.url}/api/notes/1`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)

    const list = await request(`${server.url}/api/notes`)
    assert.equal((list.body as Note[]).length, 50)
    assert.equal((await request(`${server.url}/api/notes/1`)).status, 200)
  })
})

describe('guards', () => {
  it('answers 404 JSON for unknown files, unknown paths and path tricks', async () => {
    const paths = [
      '/api/nope', '/json/nope/nope', '/nope', '/api/__proto__', '/api/constructor',
      '/api/..%2Fpackage', '/api/..%2F..%2F..%2Fetc%2Fpasswd', '/json/..%252F..%252Fpackage', '/api/notes%00.json',
      '/.git/config', '/package.json', '/src/app.ts', '/data/notes.json', '/db'
    ]
    for (const path of paths) {
      const res = await request(server.url + path)
      assert.equal(res.status, 404, path)
      assert.deepEqual(res.body, { error: 'Not found' }, path)
    }
  })

  it('answers a catastrophic _like pattern at once, and 400 for one that is too long or repeated', async () => {
    const started = performance.now()
    const res = await request(`${server.url}/api/notes?title_like=${encodeURIComponent('(.*.*)*$^')}`)
    assert.equal(res.status, 200)
    assert.ok(performance.now() - started < 1000, 'the pattern is not run as a RegExp')

    assert.equal((await request(`${server.url}/api/notes?title_like=${'a'.repeat(101)}`)).status, 400)
    assert.equal((await request(`${server.url}/api/notes?title_like=a&title_like=b`)).status, 400)
  })

  it('ignores the JSONP callback parameter', async () => {
    const res = await fetch(`${server.url}/api/notes/1?callback=steal`)
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/)
    assert.equal(((await res.json()) as Note).id, 1)
  })

  it('rejects bodies over 100 KiB with 413', async () => {
    const res = await request(`${server.url}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(200 * 1024) })
    })
    assert.equal(res.status, 413)
    assert.deepEqual(res.body, { error: 'Request body too large' })
  })

  it('answers a malformed body with a short error and no stack trace', async () => {
    const res = await request(`${server.url}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad'
    })
    assert.equal(res.status, 400)
    assert.deepEqual(res.body, { error: 'Invalid request' })
  })
})
