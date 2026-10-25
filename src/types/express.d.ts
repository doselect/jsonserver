// res.locals set by our middleware
declare global {
  namespace Express {
    /**
     * Typed `res.locals` fields set by jsonserver's routes.
     */
    interface Locals {
      /**
       * Name of the data file the request asked for (`notes` for `/api/notes/1`), set by routes/data.ts and written
       * in the access log line as `data_file`.
       */
      dataFile?: string
    }
  }
}

export {}
