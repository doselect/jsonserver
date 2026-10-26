// Checks that run before json-server sees a request, for the ways its defaults can be abused:
//   - bodies up to 10 MB, each cloned with the whole data file on a write  -> 413 past MAX_BODY_BYTES, counted after
//     decoding, chunked and gzip/deflate bodies included
//   - `<field>_like` values compiled as a RegExp (a crafted one blocks the server) -> escaped, capped at MAX_LIKE_LENGTH
//   - `?callback=` turning the answer into JSONP (script inclusion from any site) -> dropped
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import rootLogger from '../logging/logger.ts'
import { escapeRegExp } from '../utils/http.ts'
import { JSONP_CALLBACK_PARAM, LIKE_SUFFIX, MAX_BODY_BYTES, MAX_LIKE_LENGTH } from '../constants/http.ts'

/** Logger for this module (`request-guards`). */
const logger = rootLogger.forModule(import.meta.filename)

/**
 * Rejects requests whose declared body is larger than MAX_BODY_BYTES with 413.
 *
 * Checks the Content-Length header before anything reads the body. Bodies without it (chunked) or compressed ones are
 * capped while they are read, by {@link parseBody}.
 *
 * @returns {RequestHandler} Express middleware.
 */
export function limitBodySize (): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction) {
    const size = Number(req.headers['content-length'])
    if (size > MAX_BODY_BYTES) {
      logger.info('Rejected a request body larger than the limit.', { content_length: size, max_bytes: MAX_BODY_BYTES })
      res.status(413).send({ error: 'Request body too large' })
      return
    }
    next()
  }
}

/**
 * Parses JSON and form bodies with a MAX_BODY_BYTES limit, before json-server's own parser (10 MB) can.
 *
 * The limit counts the decoded bytes, so it also holds for chunked bodies and gzip/deflate ones that inflate past
 * it; those answer 413 through the app's error handler. json-server's parser then skips the already parsed body.
 *
 * @returns {RequestHandler[]} Express middleware: the JSON parser, then the urlencoded one.
 */
export function parseBody (): RequestHandler[] {
  return [
    express.json({ limit: MAX_BODY_BYTES }),
    express.urlencoded({ extended: false, limit: MAX_BODY_BYTES })
  ]
}

/**
 * Makes the query string safe for json-server: `_like` values become literal text, `callback` is dropped.
 *
 * json-server builds `new RegExp(value)` from every `<field>_like` parameter, so a pattern such as `(.*.*)*$^` can
 * keep the event loop busy for minutes. Values are escaped (a plain substring match, which is how every documented
 * example uses it) and longer than MAX_LIKE_LENGTH, or repeated (an array), answers 400. json-server answers with
 * `res.jsonp`, so `callback` is removed and every answer stays plain JSON. Relies on Express 4, where `req.query`
 * is a plain object that later middleware sees changed.
 *
 * @returns {RequestHandler} Express middleware.
 */
export function safeQuery (): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction) {
    for (const [key, value] of Object.entries(req.query)) {
      if (!key.endsWith(LIKE_SUFFIX)) continue
      if (typeof value !== 'string' || value.length > MAX_LIKE_LENGTH) {
        logger.info('Rejected a partial match query that is repeated or too long.', {
          query_param: key,
          value_length: typeof value === 'string' ? value.length : undefined,
          max_length: MAX_LIKE_LENGTH
        })
        res.status(400).send({ error: 'Invalid request' })
        return
      }
      req.query[key] = escapeRegExp(value)
    }
    if (JSONP_CALLBACK_PARAM in req.query) {
      logger.debug('Dropped the JSONP callback parameter so the answer stays JSON.')
      delete req.query[JSONP_CALLBACK_PARAM]
    }
    next()
  }
}
