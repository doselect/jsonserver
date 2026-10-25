// Request id (from X-Request-Id or generated) and one access log line per request.
// Every line logged while handling the request carries request_id
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import rootLogger from '../logging/logger.ts'
import { endpoint, remoteAddr } from '../utils/http.ts'
import { QUIET_PATHS } from '../constants/http.ts'

/** Logger for this module (`request-context`). */
const logger = rootLogger.forModule(import.meta.filename)

/**
 * Whether a path is a probe that gets no access log line: one of QUIET_PATHS, or a path under it.
 *
 * @param {string} path - Request path without the query string.
 * @returns {boolean} True for `/health`, `/health/` and `/health/anything`.
 */
export function isQuietPath (path: string): boolean {
  return QUIET_PATHS.some((quiet) => path === quiet || path.startsWith(`${quiet}/`))
}

/**
 * Builds the first middleware of the app: request id, logging context and the access log line.
 *
 * Reuses a string `X-Request-Id` header (set by the load balancer or the client) or generates a UUID, and echoes it
 * in the `X-Request-Id` response header. Everything logged while handling the request (including async work started
 * from `next()`) carries `request_id`. When the response finishes, writes one INFO access log line with the data
 * file the request asked for, except for the quiet probe paths (`QUIET_PATHS`). Responses that never finish (client
 * aborted) get no line.
 *
 * @returns {RequestHandler} Synchronous Express middleware that always calls `next()`.
 */
export default function requestContext (): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction) {
    const header = req.headers['x-request-id']
    const requestId = typeof header === 'string' && header ? header : randomUUID()
    res.setHeader('X-Request-Id', requestId)

    const started = performance.now()
    // Read now: routes/data.ts rewrites req.url, and originalUrl is what the client asked for
    const path = endpoint(req)

    logger.withContext({ request_id: requestId }, () => {
      res.on('finish', () => {
        if (isQuietPath(path)) return
        logger.info('Request completed.', {
          method: req.method,
          endpoint: path,
          data_file: res.locals.dataFile,
          status_code: res.statusCode,
          response_time_ms: Math.round((performance.now() - started) * 100) / 100,
          response_bytes: Number(res.getHeader('content-length')) || undefined,
          remote_addr: remoteAddr(req),
          origin: req.headers.origin,
          referer: req.headers.referer,
          user_agent: req.headers['user-agent']
        })
      })
      next()
    })
  }
}
