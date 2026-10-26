// The JSON files in the data folder and the json-server routers that answer them.
// Only files present when the server starts can be served: the request names a file, but the path read from disk is
// always built from that fixed list, so no request can reach any other file. Each file is parsed once, on first
// use, and kept in memory with its router; writes run against a fresh copy, so they are never saved
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import jsonServer from 'json-server'
import type { RequestHandler } from 'express'
import rootLogger from '../logging/logger.ts'
import { READ_METHODS } from '../constants/http.ts'

/** Logger for this module (`data-store`). */
const logger = rootLogger.forModule(import.meta.filename)

/** A parsed data file and the shared router that answers reads from it. */
interface LoadedFile {
  /** The parsed JSON, kept unchanged so every write starts from the original data. */
  data: object
  /** Router over a private copy of `data`, reused by every read. */
  router: RequestHandler
}

/**
 * The data files a server can serve, loaded on first use.
 */
export interface DataStore {
  /** Absolute path of the data folder. */
  readonly directory: string
  /** Names of the files that can be served (`notes` for `notes.json`), sorted. */
  readonly names: readonly string[]
  /**
   * Whether `name` is one of the files found at startup.
   *
   * @param {string} name - File name without `.json`, as given in the URL.
   * @returns {boolean} True when the file can be served.
   */
  has (name: string): boolean
  /**
   * The json-server router for a request to `name`.
   *
   * Reads (GET, HEAD, OPTIONS) share one router; any other method gets a router over a fresh copy of the data.
   *
   * @param {string} name - A name for which `has(name)` is true.
   * @param {string} method - The request's HTTP method.
   * @returns {RequestHandler} Middleware that answers the request.
   * @throws {Error} When the file cannot be read or is not valid JSON (an object at the top level).
   */
  handler (name: string, method: string): RequestHandler
}

/**
 * A json-server router over `data`, without json-server's error handler.
 *
 * json-server's router sends the error stack trace to the client, so its error handler (the 4-argument layer) is
 * removed and errors go on to the app's error handler, which logs them and answers a short message.
 *
 * @param {object} data - The data to serve; json-server changes it on writes, so pass a copy.
 * @returns {RequestHandler} The router.
 */
function createRouter (data: object): RequestHandler {
  const router = jsonServer.router(data)
  router.stack = router.stack.filter((layer) => layer.handle.length !== 4)
  return router
}

/**
 * Number of records in a parsed data file: the length of each top-level array, summed.
 *
 * @param {object} data - The parsed file.
 * @returns {number} The record count (top-level values that are not arrays count as one).
 */
function countRecords (data: object): number {
  return Object.values(data).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 1), 0)
}

/**
 * Lists the data folder and returns the store that serves its files.
 *
 * Only `*.json` files directly in `directory` are served. The list is fixed now; files added later need a restart
 * (a redeploy does that).
 *
 * @param {string} directory - The data folder (config.dataDirectory).
 * @returns {DataStore} The store.
 * @throws {Error} When the folder cannot be read (ENOENT, EACCES, ...).
 */
export default function createDataStore (directory: string): DataStore {
  const names = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.basename(file, '.json'))
    .sort()
  const known = new Set(names)
  const cache = new Map<string, LoadedFile>()
  logger.info('Found the data files to serve.', { data_directory: directory, data_files: names, data_file_count: names.length })

  /**
   * Parses a data file and builds its read router, once; later calls return the cached result.
   *
   * @param {string} name - A known file name.
   * @returns {LoadedFile} The parsed data and its router.
   * @throws {Error} When the file cannot be read or does not hold a JSON object.
   */
  function load (name: string): LoadedFile {
    const cached = cache.get(name)
    if (cached) return cached

    const started = performance.now()
    const file = path.join(directory, `${name}.json`)
    const text = fs.readFileSync(file, 'utf8')
    const data: unknown = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`${name}.json must hold a JSON object whose keys are the resources`)
    }
    const loaded: LoadedFile = { data, router: createRouter(structuredClone(data)) }
    cache.set(name, loaded)
    logger.info('Loaded the data file into memory.', {
      data_file: name,
      resources: Object.keys(data),
      records: countRecords(data),
      size_bytes: Buffer.byteLength(text),
      load_time_ms: Math.round((performance.now() - started) * 100) / 100
    })
    return loaded
  }

  return {
    directory,
    names,
    has: (name) => known.has(name),
    handler (name, method) {
      const loaded = load(name)
      if (READ_METHODS.has(method)) return loaded.router
      logger.debug('Answering a write request from a fresh copy of the data, so nothing is saved.', { data_file: name, method })
      return createRouter(structuredClone(loaded.data))
    }
  }
}
