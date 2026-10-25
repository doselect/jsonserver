// The data store and the app over small fixture folders: which files are served, caching, writes on fresh copies,
// and files that cannot be served (not JSON, not an object) answering 500 while the rest keep working
import './env.ts'
import { afterAll, beforeAll, describe, it } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import createDataStore from '../src/services/data-store.ts'
import createApp from '../src/app.ts'
import { request } from './helpers.ts'

/** Fixture folder for this suite, removed in afterAll. */
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonserver-data-'))
  fs.writeFileSync(path.join(dir, 'books.json'), JSON.stringify({ books: [{ id: 1, title: 'Dune' }, { id: 2, title: 'Emma' }] }))
  fs.writeFileSync(path.join(dir, 'animals.json'), JSON.stringify({ animals: [{ id: 1, name: 'cat' }] }))
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ "broken": [')
  fs.writeFileSync(path.join(dir, 'list.json'), '[1, 2, 3]')
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'not served')
  fs.mkdirSync(path.join(dir, 'nested'))
  fs.writeFileSync(path.join(dir, 'nested', 'hidden.json'), '{"hidden": []}')
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('createDataStore', () => {
  it('serves only the .json files directly in the folder, sorted', () => {
    const store = createDataStore(dir)
    assert.deepEqual(store.names, ['animals', 'books', 'broken', 'list'])
    assert.equal(store.directory, dir)
  })

  it('knows nothing outside that list, including object prototype names', () => {
    const store = createDataStore(dir)
    for (const name of ['readme', 'hidden', 'nested/hidden', '../books', '__proto__', 'constructor', 'toString', '']) {
      assert.equal(store.has(name), false, name)
    }
  })

  it('shares one router for reads and builds a fresh one for each write', () => {
    const store = createDataStore(dir)
    const read = store.handler('books', 'GET')
    assert.equal(store.handler('books', 'HEAD'), read)
    assert.equal(store.handler('books', 'OPTIONS'), read)
    const write = store.handler('books', 'POST')
    assert.notEqual(write, read)
    assert.notEqual(store.handler('books', 'POST'), write)
  })

  it('parses a file once and keeps it in memory', () => {
    const file = path.join(dir, 'animals.json')
    const original = fs.readFileSync(file, 'utf8')
    const store = createDataStore(dir)
    const first = store.handler('animals', 'GET')
    try {
      fs.writeFileSync(file, JSON.stringify({ animals: [] }))
      assert.equal(store.handler('animals', 'GET'), first)
    } finally {
      fs.writeFileSync(file, original)
    }
  })

  it('throws for a file that is not valid JSON or not an object', () => {
    const store = createDataStore(dir)
    assert.throws(() => store.handler('broken', 'GET'), SyntaxError)
    assert.throws(() => store.handler('list', 'GET'), /must hold a JSON object/)
  })

  it('throws when the folder cannot be read', () => {
    assert.throws(() => createDataStore(path.join(dir, 'missing')), { code: 'ENOENT' })
    assert.throws(() => createApp({ dataDirectory: path.join(dir, 'missing') }), { code: 'ENOENT' })
  })
})

describe('the app over a fixture folder', () => {
  let url: string
  let server: http.Server

  beforeAll(async () => {
    server = http.createServer(createApp({ dataDirectory: dir }).app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('serves the fixture files and nothing else', async () => {
    assert.deepEqual((await request(`${url}/api/books/2`)).body, { id: 2, title: 'Emma' })
    for (const path of ['/api/readme', '/api/hidden', '/api/nested', '/api/notes']) {
      assert.equal((await request(url + path)).status, 404, path)
    }
  })

  it('answers 500 "Unable to load data" for a broken file, every time, while the others keep working', async () => {
    for (const name of ['broken', 'list', 'broken']) {
      const res = await request(`${url}/api/${name}`)
      assert.equal(res.status, 500, name)
      assert.deepEqual(res.body, { error: 'Unable to load data' })
    }
    assert.equal((await request(`${url}/api/books`)).status, 200)
  })

  it('keeps every write private to its request', async () => {
    const post = (title: string) => request(`${url}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
    const [first, second] = await Promise.all([post('A'), post('B')])
    // Both start from the original two books, so both get id 3
    assert.equal((first.body as { id: number }).id, 3)
    assert.equal((second.body as { id: number }).id, 3)
    assert.equal(((await request(`${url}/api/books`)).body as unknown[]).length, 2)
  })
})
