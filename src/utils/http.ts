// HTTP request helpers
import type { IncomingMessage } from 'node:http'
import type { Request } from 'express'

/**
 * Returns the full request path, without the query string.
 *
 * Full request path, also inside mounted middleware where Express strips the mount prefix from req.path (and after
 * routes/data.ts rewrites req.url). Parsed from `req.originalUrl` with a dummy base; the path stays percent-encoded.
 *
 * @param {Request} req - Express request.
 * @returns {string} Path such as `/api/notes/1`.
 */
export function endpoint (req: Request): string {
  return new URL(req.originalUrl, 'http://localhost').pathname
}

/**
 * First X-Forwarded-For hop (set by the load balancer), else the socket address.
 *
 * For logging only: the header is client controlled when there is no proxy in front, so never use it for access
 * control.
 *
 * @param {IncomingMessage} req - Incoming HTTP request.
 * @returns {string | undefined} Client address, or undefined when the socket has none (already closed).
 */
export function remoteAddr (req: IncomingMessage): string | undefined {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0]?.trim()
  return req.socket.remoteAddress
}

/**
 * Escapes every RegExp special character, so the value matches itself literally.
 *
 * @param {string} value - Text to match as is.
 * @returns {string} The escaped pattern, e.g. `a\.b` for `a.b`.
 */
export function escapeRegExp (value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
