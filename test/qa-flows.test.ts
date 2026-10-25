// QA_GUIDE.md flows B-G, step by step, against the real data folder: each case is named after its step id, so a
// failure points at the row of the guide that no longer holds
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

/** A record of any dataset. */
type Item = Record<string, unknown>

/**
 * GETs a path and returns the body as a list of records.
 *
 * @param {string} path - Path and query, e.g. `/api/notes?_limit=5`.
 * @returns {Promise<Item[]>} The parsed array.
 */
async function list (path: string): Promise<Item[]> {
  const res = await request(server.url + path)
  assert.equal(res.status, 200, path)
  assert.ok(Array.isArray(res.body), `${path} answers an array`)
  return res.body as Item[]
}

/**
 * The `id` of each record, in order.
 *
 * @param {Item[]} items - Records.
 * @returns {unknown[]} Their ids.
 */
function ids (items: Item[]): unknown[] {
  return items.map((item) => item.id)
}

/** Section 3 of the guide: every dataset, its record count, and whether get-by-id works. */
const DATASETS: Array<{ name: string, records: number, hasId: boolean }> = [
  { name: 'countries', records: 250, hasId: true },
  { name: 'domestic_flights', records: 38, hasId: true },
  { name: 'employees', records: 500, hasId: true },
  { name: 'flights', records: 5, hasId: true },
  { name: 'inventory', records: 500, hasId: false },
  { name: 'leaves', records: 50, hasId: true },
  { name: 'matches', records: 53, hasId: false },
  { name: 'notes', records: 50, hasId: true },
  { name: 'universities', records: 100, hasId: true }
]

/** Text that must never appear in an error body (flow F): stack traces and server paths. */
const LEAKS = [/Error:/, /\bat /, /\/webapps\//, /node_modules/]

describe('flow B: read APIs for every dataset', () => {
  for (const { name, records } of DATASETS) {
    it(`B1: /api/${name} lists ${records} records`, async () => {
      assert.equal((await list(`/api/${name}`)).length, records)
    })
  }

  for (const { name } of DATASETS.filter((dataset) => dataset.hasId)) {
    it(`B2: /api/${name}/1 returns the record with id 1`, async () => {
      const res = await request(`${server.url}/api/${name}/1`)
      assert.equal(res.status, 200)
      assert.equal((res.body as Item).id, 1)
    })
  }

  it('B3: an id that does not exist answers 404 {}', async () => {
    const res = await request(`${server.url}/api/notes/999`)
    assert.equal(res.status, 404)
    assert.deepEqual(res.body, {})
  })

  it('B4: datasets without an id answer 404 {} to get-by-id', async () => {
    for (const name of ['inventory', 'matches']) {
      const res = await request(`${server.url}/api/${name}/1`)
      assert.equal(res.status, 404, name)
      assert.deepEqual(res.body, {}, name)
    }
  })

  it('B5: inventory is found by barcode', async () => {
    const items = await list('/api/inventory?barcode=74001755')
    assert.equal(items.length, 1)
    assert.equal(String(items[0]?.barcode), '74001755')
  })
})

describe('flow C: URL formats', () => {
  it('C1: /api/notes/2, /api/notes/notes/2 and /json/notes/notes/2 return the same note', async () => {
    const bodies = await Promise.all(['/api/notes/2', '/api/notes/notes/2', '/json/notes/notes/2'].map(async (path) => {
      const res = await request(server.url + path)
      assert.equal(res.status, 200, path)
      return res.body
    }))
    assert.equal((bodies[0] as Item).id, 2)
    assert.deepEqual(bodies[1], bodies[0])
    assert.deepEqual(bodies[2], bodies[0])
  })

  it('C2: answers directly, without a redirect', async () => {
    const res = await fetch(`${server.url}/api/notes`, { redirect: 'manual' })
    assert.equal(res.status, 200)
    await res.text()
  })

  it('C3: the query string is applied', async () => {
    assert.deepEqual(ids(await list('/api/notes?title_like=Buy')), [2, 42, 50])
  })
})

describe('flow D: filtering, search, sorting and pagination', () => {
  it('D1: exact match on a field', async () => {
    assert.deepEqual(ids(await list(`/api/notes?title=${encodeURIComponent('Learn node.js')}`)), [1])
  })

  it('D2: range with _gte and _lte', async () => {
    assert.deepEqual(ids(await list('/api/notes?id_gte=1&id_lte=5')), [1, 2, 3, 4, 5])
  })

  it('D3: _ne excludes a value', async () => {
    const items = await list('/api/notes?id_ne=1')
    assert.equal(items.length, 49)
    assert.ok(!ids(items).includes(1))
  })

  it('D4: _like matches part of a field', async () => {
    assert.deepEqual(ids(await list('/api/notes?title_like=Learn')), [1, 17, 26, 31, 38, 46])
  })

  it('D5: a repeated field matches any of the values', async () => {
    assert.deepEqual(ids(await list('/api/notes?id=1&id=2')), [1, 2])
  })

  it('D6: q searches every field', async () => {
    const items = await list('/api/notes?q=passport')
    assert.deepEqual(ids(items), [11])
    assert.equal(items[0]?.title, 'Renew passport')
  })

  it('D7: _sort with _order=desc', async () => {
    assert.equal((await list('/api/notes?_sort=id&_order=desc'))[0]?.id, 50)
  })

  it('D8: _page and _limit, with X-Total-Count and Link headers', async () => {
    const res = await request(`${server.url}/api/notes?_page=2&_limit=5`)
    assert.deepEqual(ids(res.body as Item[]), [6, 7, 8, 9, 10])
    assert.equal(res.headers.get('x-total-count'), '50')
    const link = res.headers.get('link') ?? ''
    for (const rel of ['first', 'prev', 'next', 'last']) assert.match(link, new RegExp(`rel="${rel}"`))
  })

  it('D9: _start and _limit', async () => {
    const res = await request(`${server.url}/api/notes?_start=0&_limit=5`)
    assert.deepEqual(ids(res.body as Item[]), [1, 2, 3, 4, 5])
    assert.equal(res.headers.get('x-total-count'), '50')
  })

  it('D10: _like, sort and limit together', async () => {
    assert.deepEqual(ids(await list('/api/notes?title_like=Learn&_sort=id&_order=desc&_limit=2')), [46, 38])
  })
})

describe('flow E: write requests are answered but never saved', () => {
  /**
   * Sends a JSON body.
   *
   * @param {string} method - POST, PUT or PATCH.
   * @param {string} path - Path, e.g. `/api/notes/1`.
   * @param {unknown} body - Sent as JSON.
   * @returns {Promise<import('./helpers.ts').JsonResponse>} The parsed answer.
   */
  const send = (method: string, path: string, body: unknown) => request(server.url + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  it('E1, E2: POST answers 201 with id 51, which is then not found', async () => {
    const created = await send('POST', '/api/notes', { title: 'QA note', description: 'test' })
    assert.equal(created.status, 201)
    assert.equal((created.body as Item).id, 51)
    assert.equal((await request(`${server.url}/api/notes/51`)).status, 404)
  })

  it('E3, E4: PATCH answers the change, which is then not there', async () => {
    const patched = await send('PATCH', '/api/notes/1', { title: 'Changed' })
    assert.equal(patched.status, 200)
    assert.equal((patched.body as Item).title, 'Changed')
    assert.equal(((await request(`${server.url}/api/notes/1`)).body as Item).title, 'Learn node.js')
  })

  it('E5: PUT answers the replaced record', async () => {
    const replaced = await send('PUT', '/api/notes/1', { title: 'Replaced', description: 'x' })
    assert.equal(replaced.status, 200)
    assert.deepEqual(replaced.body, { id: 1, title: 'Replaced', description: 'x' })
  })

  it('E6: DELETE answers 200 and the record is still there', async () => {
    const res = await fetch(`${server.url}/api/notes/1`, { method: 'DELETE' })
    assert.equal(res.status, 200)
    await res.text()
    assert.equal((await request(`${server.url}/api/notes/1`)).status, 200)
  })

  it('E7: PUT or PATCH of an id that does not exist answers 404', async () => {
    assert.equal((await send('PUT', '/api/notes/999', { title: 'x' })).status, 404)
    assert.equal((await send('PATCH', '/api/notes/999', { title: 'x' })).status, 404)
  })

  it('E8: POST to a dataset without ids works when the body has one', async () => {
    assert.equal((await send('POST', '/api/matches', { id: 'qa-1', team1: 'A' })).status, 201)
  })
})

describe('flow F: errors and security', () => {
  /**
   * Asserts the raw body has no stack trace or server path in it.
   *
   * @param {string} path - Request path, for the message.
   * @param {string} text - The raw response body.
   * @returns {void}
   */
  function assertNoLeak (path: string, text: string): void {
    for (const pattern of LEAKS) assert.doesNotMatch(text, pattern, `${path} leaks ${String(pattern)}`)
  }

  const notFound: Array<[string, string]> = [['F1', '/api/doesnotexist'], ['F2', '/api/..%2F..%2Fpackage'], ['F3', '/json/..%2F..%2Fpackage.json/x'], ['F4', '/api/health_check']]
  for (const [id, path] of notFound) {
    it(`${id}: ${path} answers 404 {"error":"Not found"}`, async () => {
      const res = await fetch(server.url + path)
      const text = await res.text()
      assert.equal(res.status, 404)
      assert.deepEqual(JSON.parse(text), { error: 'Not found' })
      assertNoLeak(path, text)
    })
  }

  it('F5: a broken JSON body answers 400 without a stack trace', async () => {
    const res = await fetch(`${server.url}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    const text = await res.text()
    assert.equal(res.status, 400)
    assert.deepEqual(JSON.parse(text), { error: 'Invalid request' })
    assertNoLeak('F5', text)
  })

  it('F6: POST without an id to a dataset that has none answers 500 without a stack trace', async () => {
    for (const name of ['inventory', 'matches']) {
      const res = await fetch(`${server.url}/api/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' })
      const text = await res.text()
      assert.equal(res.status, 500, name)
      assert.deepEqual(JSON.parse(text), { error: 'Something went wrong' })
      assertNoLeak(name, text)
    }
  })

  it('F7: no X-Powered-By header on any answer', async () => {
    for (const path of ['/', '/health', '/api/notes/1', '/api/nope', '/nope']) {
      const res = await fetch(server.url + path)
      await res.text()
      assert.equal(res.headers.get('x-powered-by'), null, path)
    }
  })

  it('F8: the server is still running after the negative tests', async () => {
    assert.equal((await request(`${server.url}/health`)).status, 200)
    assert.equal((await request(`${server.url}/api/notes/1`)).status, 200)
  })
})

describe('flow G: CORS', () => {
  it('G1: echoes the origin of a browser request', async () => {
    const res = await fetch(`${server.url}/api/notes/1`, { headers: { Origin: 'https://example.com' } })
    await res.text()
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.com')
  })

  it('G2: answers a preflight with 204', async () => {
    const res = await fetch(`${server.url}/api/notes`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' }
    })
    await res.text()
    assert.equal(res.status, 204)
  })
})
