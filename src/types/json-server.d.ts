// Types for the parts of json-server 0.17 we use (its own package has none, and @types/json-server pulls in the
// Express 5 types while json-server runs on Express 4)
declare module 'json-server' {
  import type { Express, RequestHandler } from 'express'

  /** Options of `jsonServer.defaults()`. */
  interface DefaultsOptions {
    /** Adds the morgan request logger (default true); jsonserver logs requests itself. */
    logger?: boolean
    /** Folder served as static files (default `public`); its middleware is removed by jsonserver. */
    static?: string
    /** Leaves out the CORS middleware (default false). */
    noCors?: boolean
    /** Leaves out gzip compression (default false). */
    noGzip?: boolean
    /** Answers 403 to every write (default false). */
    readOnly?: boolean
  }

  /** One entry of an Express router's middleware stack; error handlers take 4 arguments. */
  interface RouterLayer {
    /** The middleware function; `handle.length === 4` marks an error handler. */
    handle: { length: number }
  }

  /** The router json-server builds from the data: an Express router whose stack can be edited. */
  type JsonServerRouter = RequestHandler & {
    /** Middleware layers in order; jsonserver removes the error handler, which sends stack traces to clients. */
    stack: RouterLayer[]
  }

  /** The json-server module (CommonJS). */
  const jsonServer: {
    /** A new Express 4 app. */
    create (): Express
    /** json-server's default middlewares: CORS, gzip, no-cache headers, static files, request logger. */
    defaults (options?: DefaultsOptions): RequestHandler[]
    /** A REST router over `data`: each top-level key is a resource (`/notes`, `/notes/1`, filters, paging). */
    router (data: object): JsonServerRouter
  }
  export = jsonServer
}
