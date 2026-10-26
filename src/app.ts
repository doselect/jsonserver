// Express app (json-server's Express 4): request context, json-server's defaults, request guards, the data routes,
// health, and JSON answers for unknown paths and errors
import jsonServer from 'json-server'
import type { Express, NextFunction, Request, Response } from 'express'
import config from './config/index.ts'
import rootLogger from './logging/logger.ts'
import { endpoint } from './utils/http.ts'
import { errorStatus } from './utils/errors.ts'
import requestContext from './middlewares/request-context.ts'
import { limitBodySize, parseBody, safeQuery } from './middlewares/request-guards.ts'
import createDataStore, { type DataStore } from './services/data-store.ts'
import dataRoutes from './routes/data.ts'
import health from './routes/health.ts'
import { NOT_FOUND_BODY } from './constants/http.ts'

/** Logger for this module (`app`). */
const logger = rootLogger.forModule(import.meta.filename)

/** Options for {@link createApp}. */
export interface AppOptions {
  /** Folder of the JSON files to serve; defaults to config.dataDirectory (DATA_DIRECTORY). */
  dataDirectory: string
}

/** The app plus the data store it serves, so index.ts can log what it found. */
export interface JsonServerApp {
  /** The configured Express app; pass it to http.createServer. */
  app: Express
  /** The data files the app serves. */
  store: DataStore
}

/**
 * Builds the Express app.
 *
 * Middleware order matters: request context (request_id, access log), json-server's defaults (CORS, gzip, no-cache
 * headers) without its static welcome page and morgan logger, the request guards (body size and parsing, `_like`,
 * JSONP), the data routes, `/` and `/health`, 404 JSON for anything else, and a final error handler that logs the
 * error and answers a short JSON message without the stack trace. Creates no sockets; index.ts passes the app to
 * http.createServer.
 *
 * @param {Partial<AppOptions>} [options] - Overrides for tests.
 * @param {string} [options.dataDirectory] - Folder of the JSON files; default config.dataDirectory.
 * @returns {JsonServerApp} The app and its data store.
 * @throws {Error} When the data folder cannot be read.
 */
export default function createApp ({ dataDirectory = config.dataDirectory }: Partial<AppOptions> = {}): JsonServerApp {
  const store = createDataStore(dataDirectory)
  const app = jsonServer.create()

  // Don't tell the user we are serving the API requests through expressjs
  app.disable('x-powered-by')
  // Express's own last-resort handler (an error thrown by the error handler below, a target URL its router cannot
  // parse) sends the stack trace to the client unless env is production, whatever NODE_ENV says
  app.set('env', 'production')

  app.use(requestContext())
  // json-server's static middleware serves its "Congrats" welcome page at /, which exposes the json-server version
  // and external links, so it is left out everywhere. Its morgan logger is off too: requests are logged as JSON
  app.use(jsonServer.defaults({ logger: false }).filter((middleware) => middleware.name !== 'serveStatic'))
  app.use(limitBodySize())
  app.use(parseBody())
  app.use(safeQuery())
  app.use(dataRoutes(store))
  app.use(health())

  // Unknown paths get JSON instead of Express's default HTML 404 page
  app.use(function (_req: Request, res: Response) {
    res.status(404).send(NOT_FOUND_BODY)
  })

  // Errors are logged on the server, clients only get a short message without the stack trace. Client errors
  // (malformed JSON body, body too large once decoded) are WARNING, anything else ERROR.
  // Express recognizes an error handler by its 4 parameters, so `_next` must stay
  app.use(function (err: unknown, req: Request, res: Response, _next: NextFunction) {
    const status = errorStatus(err)
    if (status < 500) {
      logger.warning('Rejected an invalid request.', { endpoint: endpoint(req), status_code: status, err })
    } else {
      logger.error('Unexpected error while processing request.', { endpoint: endpoint(req), status_code: status, err })
    }
    const error = status === 413 ? 'Request body too large' : status < 500 ? 'Invalid request' : 'Something went wrong'
    res.status(status).send({ error })
  })

  return { app, store }
}
