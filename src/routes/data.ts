// /api/<file>/... (the default) and /json/<file>/... (kept for older clients): answers from data/<file>.json.
// `/api/notes/1` and `/api/notes/notes/1` both reach the `notes` resource; `/json` needs the resource in the URL
import express, { type NextFunction, type Request, type Response, type Router } from 'express'
import rootLogger from '../logging/logger.ts'
import type { DataStore } from '../services/data-store.ts'
import { API_PREFIX, JSON_PREFIX, NOT_FOUND_BODY } from '../constants/http.ts'

/** Logger for this module (`data`). */
const logger = rootLogger.forModule(import.meta.filename)

/**
 * Builds the router for the data files.
 *
 * A name not in the data folder answers 404 `{ "error": "Not found" }`. A file that cannot be read or parsed is
 * logged at ERROR and answers 500 `{ "error": "Unable to load data" }`. Otherwise json-server answers: lists, get by
 * id, filters, `_like`, `q`, `_sort`, `_page`/`_limit`, and writes that are never saved. Sets `res.locals.dataFile`
 * for the access log.
 *
 * @param {DataStore} store - The data files that can be served.
 * @returns {Router} Express router to mount at the application root.
 */
export default function dataRoutes (store: DataStore): Router {
  const router = express.Router()

  /**
   * Hands the request to the json-server router of `fileName`.
   *
   * @param {string} fileName - File name from the URL, without `.json`.
   * @param {Request} req - The request; its url is relative to the file's mount point.
   * @param {Response} res - The response.
   * @param {NextFunction} next - Goes on to the error handler when json-server fails.
   * @returns {void}
   */
  function serve (fileName: string, req: Request, res: Response, next: NextFunction): void {
    res.locals.dataFile = fileName
    if (!store.has(fileName)) {
      logger.info('Received a request for a data file that does not exist.', { data_file: fileName })
      res.status(404).send(NOT_FOUND_BODY)
      return
    }

    let handler
    try {
      handler = store.handler(fileName, req.method)
    } catch (err) {
      logger.error('Failed to load the data file.', { data_file: fileName, err })
      res.status(500).send({ error: 'Unable to load data' })
      return
    }
    handler(req, res, next)
  }

  router.use(`${API_PREFIX}/:fileName`, function (req, res, next) {
    const { fileName = '' } = req.params
    const [, firstSegment] = req.url.split(/[/?]/)
    // The file name doubles as the resource name, so it is added when the URL leaves it out
    if (firstSegment !== fileName) req.url = `/${fileName}${req.url}`
    serve(fileName, req, res, next)
  })

  router.use(`${JSON_PREFIX}/:fileName`, function (req, res, next) {
    serve(req.params.fileName ?? '', req, res, next)
  })

  return router
}
