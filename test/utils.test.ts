// The small helpers on their own: path and address parsing, RegExp escaping, error fields, timestamps, quiet paths
import './env.ts'
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import type { Request } from 'express'
import { endpoint, escapeRegExp, remoteAddr } from '../src/utils/http.ts'
import { errorCode, errorStatus } from '../src/utils/errors.ts'
import { asctime } from '../src/utils/time.ts'
import { localDay } from '../src/logging/daily-file-transport.ts'
import { isQuietPath } from '../src/middlewares/request-context.ts'

/**
 * A request with only the fields remoteAddr() reads.
 *
 * @param {Record<string, string>} headers - Request headers.
 * @param {string} [socketAddress] - The socket's remote address.
 * @returns {IncomingMessage} The fake request.
 */
function fakeRequest (headers: Record<string, string>, socketAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress: socketAddress } } as unknown as IncomingMessage
}

describe('endpoint', () => {
  it('returns the original path without the query string, still percent-encoded', () => {
    assert.equal(endpoint({ originalUrl: '/api/notes/1?x=1&y=2' } as Request), '/api/notes/1')
    assert.equal(endpoint({ originalUrl: '/api/..%2Fpackage' } as Request), '/api/..%2Fpackage')
    assert.equal(endpoint({ originalUrl: '/' } as Request), '/')
  })
})

describe('remoteAddr', () => {
  it('takes the first X-Forwarded-For hop, trimmed', () => {
    assert.equal(remoteAddr(fakeRequest({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }, '10.0.0.2')), '203.0.113.7')
  })

  it('falls back to the socket address, or undefined without one', () => {
    assert.equal(remoteAddr(fakeRequest({}, '10.0.0.2')), '10.0.0.2')
    assert.equal(remoteAddr(fakeRequest({ 'x-forwarded-for': '' }, '10.0.0.2')), '10.0.0.2')
    assert.equal(remoteAddr(fakeRequest({})), undefined)
  })
})

describe('escapeRegExp', () => {
  it('makes every special character match itself', () => {
    const special = '.*+?^${}()|[]\\'
    assert.ok(new RegExp(escapeRegExp(special)).test(`x${special}y`))
    assert.ok(!new RegExp(escapeRegExp('a.c')).test('abc'))
  })

  it('turns a catastrophic pattern into plain text that runs at once', () => {
    const started = performance.now()
    assert.ok(!new RegExp(escapeRegExp('(.*.*)*$^'), 'i').test('a'.repeat(50000)))
    assert.ok(performance.now() - started < 100)
  })
})

describe('errorCode', () => {
  it('reads a string code from anything thrown', () => {
    assert.equal(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT')
    assert.equal(errorCode({ code: 'EACCES' }), 'EACCES')
  })

  it('ignores non-string codes and values without one', () => {
    for (const value of [Object.assign(new Error('x'), { code: 1 }), new Error('x'), null, undefined, 'ENOENT', 42]) {
      assert.equal(errorCode(value), undefined)
    }
  })
})

describe('errorStatus', () => {
  it('reads status or statusCode in the 4xx-5xx range', () => {
    assert.equal(errorStatus({ status: 400 }), 400)
    assert.equal(errorStatus({ statusCode: 413 }), 413)
    assert.equal(errorStatus({ status: 503 }), 503)
  })

  it('falls back to 500 for anything else', () => {
    for (const value of [new Error('x'), { status: 200 }, { status: 302 }, { status: 600 }, { status: '400' }, null, 'boom']) {
      assert.equal(errorStatus(value), 500)
    }
  })
})

describe('timestamps', () => {
  it('asctime is UTC in Python %Y-%m-%dT%H:%M:%S%z form, without milliseconds', () => {
    assert.equal(asctime(new Date('2026-10-23T17:57:07.123Z')), '2026-10-23T17:57:07+0000')
    assert.match(asctime(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/)
  })

  it('localDay is the local calendar day, zero padded', () => {
    assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
    assert.equal(localDay(new Date(2026, 11, 31, 0, 0)), '2026-12-31')
  })
})

describe('isQuietPath', () => {
  it('is true for /health and anything under it', () => {
    for (const path of ['/health', '/health/', '/health/deep']) assert.ok(isQuietPath(path), path)
  })

  it('is false for everything else, including look-alikes', () => {
    for (const path of ['/', '/healthz', '/health-check', '/api/health', '/api/notes']) assert.ok(!isQuietPath(path), path)
  })
})
