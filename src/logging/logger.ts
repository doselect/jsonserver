// JSON logger following the DoSelect logging standard (do-engage-service `logging_prompt.md`), the same as eden's:
// one flat JSON object per line, starting with
//   levelname, asctime, module, process, thread, message, do_service, do_role
// followed by snake_case context fields at the root level. `message` is a complete sentence without ids or values;
// those go in fields. Pass an error as `{ err }` (or `{ error }`) and it becomes error, error_type, error_code,
// exc_type, exc_value (plus exc_info with the stack trace at ERROR and CRITICAL).
//
// Each module takes its own logger:  const logger = rootLogger.forModule(import.meta.filename)
// Request context (request_id) is kept in AsyncLocalStorage and added to every line logged while handling it:
//   logger.withContext({ request_id }, () => next())
//
// Output goes to stdout (LOG_STDOUT) and/or <LOG_DIRECTORY>/application.log. The file name never has a date, as in
// the Django/FastAPI services whose Filebeat reads only application.log: each day the previous day's lines move to
// application-YYYY-MM-DD.log.gz, kept LOG_RETENTION_DAYS days (daily-file-transport.ts)
import path from 'node:path'
import { threadId } from 'node:worker_threads'
import { AsyncLocalStorage } from 'node:async_hooks'
import winston from 'winston'
import config from '../config/index.ts'
import { DailyFileTransport } from './daily-file-transport.ts'
import { asctime } from '../utils/time.ts'
import { LEVEL_PRIORITIES, LOG_FILE_NAME, LOG_LEVELS, ROOT_FOLDERS, STACK_TRACE_LEVELS, type LogLevel } from '../constants/logging.ts'

/**
 * Extra fields for a log line: snake_case keys, plus `err` for an error.
 *
 * Fields are written at the root of the JSON line after the standard keys; `undefined` values are dropped, Error
 * values become their message and bigints their decimal string. `err` (or an Error in `error`) is expanded into
 * error, error_type, error_code, exc_type, exc_value and, at ERROR/CRITICAL, exc_info.
 */
export type LogFields = Record<string, unknown>

/**
 * Logger handed to every module: one method per Python logging level, plus module and context scoping.
 *
 * Every method writes one JSON line to the configured transports (LOG_STDOUT, LOG_DIRECTORY).
 *
 * @example
 *   const logger = rootLogger.forModule(import.meta.filename)
 *   logger.info('Loaded the data file.', { data_file: 'notes', records: 50 })
 */
export interface Logger {
  /**
   * Logs a line at DEBUG (written only when LOG_LEVEL is DEBUG).
   *
   * @param {string} message - Complete sentence with no ids or values in it.
   * @param {LogFields} [fields] - snake_case context fields; `err` for an error.
   * @returns {void} Nothing.
   */
  debug (message: string, fields?: LogFields): void
  /**
   * Logs a line at INFO.
   *
   * @param {string} message - Complete sentence with no ids or values in it.
   * @param {LogFields} [fields] - snake_case context fields; `err` for an error.
   * @returns {void} Nothing.
   */
  info (message: string, fields?: LogFields): void
  /**
   * Logs a line at WARNING.
   *
   * @param {string} message - Complete sentence with no ids or values in it.
   * @param {LogFields} [fields] - snake_case context fields; `err` for an error.
   * @returns {void} Nothing.
   */
  warning (message: string, fields?: LogFields): void
  /**
   * Logs a line at ERROR; the line carries exc_info (stack trace) when `fields.err` is an Error.
   *
   * @param {string} message - Complete sentence with no ids or values in it.
   * @param {LogFields} [fields] - snake_case context fields; `err` for an error.
   * @returns {void} Nothing.
   */
  error (message: string, fields?: LogFields): void
  /**
   * Logs a line at CRITICAL.
   *
   * Used for failures that end the process (bad config, uncaught exception, port in use, shutdown timeout).
   *
   * @param {string} message - Complete sentence with no ids or values in it.
   * @param {LogFields} [fields] - snake_case context fields; `err` for an error.
   * @returns {void} Nothing.
   */
  critical (message: string, fields?: LogFields): void
  /**
   * Logger whose lines carry `module`: the file name, or the folder name for a folder's index file.
   *
   * The name drops the .ts/.js extension; `index` files under src/ or dist/ keep `index`.
   *
   * @param {string} filename - Path of the calling module, normally `import.meta.filename`.
   * @returns {Logger} A child logger bound to that module name.
   * @example
   *   const logger = rootLogger.forModule(import.meta.filename) // src/routes/data.ts logs as "data"
   */
  forModule (filename: string): Logger
  /**
   * Runs `fn` with `fields` added to every line logged inside it, including async continuations.
   *
   * Uses AsyncLocalStorage; fields are merged over any context already active, so nested calls add to it. Fields
   * passed directly to a log call override context fields of the same name.
   *
   * @param {LogFields} fields - Context fields such as request_id.
   * @param {() => T} fn - Function to run inside the context.
   * @returns {T} Whatever `fn` returns (a Promise stays in context until it settles).
   * @example
   *   logger.withContext({ request_id }, () => next())
   */
  withContext<T> (fields: LogFields, fn: () => T): T
}

/** Context fields of the request being handled, added to every line logged within it. */
const context = new AsyncLocalStorage<LogFields>()

/** Optional properties read from errors thrown by Node and fetch(). */
interface ErrorDetails {
  /** Node/system error code (ENOENT, EADDRINUSE, ...) or library code (entity.too.large, ...). */
  code?: unknown
  /** Underlying error; fetch() keeps the actual network reason in `cause.code`. */
  cause?: { code?: unknown }
}

/**
 * Turns a logged error into the standard error fields of a log line.
 *
 * A non-Error value only gives `error` (its message, JSON, or string form). An Error gives error, error_type,
 * error_code, exc_type, exc_value and, at levels in STACK_TRACE_LEVELS (error, critical), exc_info with the stack.
 *
 * @param {unknown} err - The value passed as `err` (or an Error passed as `error`).
 * @param {string} level - Log level of the line ('debug' ... 'critical').
 * @returns {LogFields} Fields to add to the line; some may be undefined and are then omitted.
 */
function errorFields (err: unknown, level: string): LogFields {
  if (!(err instanceof Error)) {
    let error: unknown = err
    if (err && typeof err === 'object') {
      try {
        error = 'message' in err ? err.message : JSON.stringify(err)
      } catch {
        error = String(err)
      }
    }
    return { error: String(error) }
  }
  const details = err as Error & ErrorDetails
  const fields: LogFields = {
    error: err.message,
    error_type: err.constructor?.name || err.name,
    // fetch() keeps the actual reason (ECONNREFUSED, ...) in err.cause
    error_code: details.code ?? details.cause?.code,
    exc_type: err.name,
    exc_value: err.message
  }
  if (STACK_TRACE_LEVELS.has(level)) fields.exc_info = err.stack
  return fields
}

/**
 * Winston format that renders each entry as one DoSelect-standard JSON line.
 *
 * Key order: levelname, asctime, module (default `jsonserver`), process, thread, message, do_service and do_role
 * (SERVICE_NAME, SERVICE_ROLE), then the AsyncLocalStorage context and call fields, then the error fields.
 * Indented with 2 spaces when LOG_PRETTY=true.
 */
const standardJson = winston.format.printf((info) => {
  const { level, message, module: moduleName, ...fields } = { ...context.getStore(), ...info } as LogFields & { level: string, message: unknown, module?: unknown }
  // The error goes in `err`; `error: <Error>` is accepted too
  let err = fields.err
  delete fields.err
  if (err === undefined && fields.error instanceof Error) {
    err = fields.error
    delete fields.error
  }
  const line: LogFields = {
    levelname: level.toUpperCase(),
    asctime: asctime(),
    module: moduleName || 'jsonserver',
    process: process.pid,
    thread: threadId,
    message,
    do_service: config.logging.serviceName,
    do_role: config.logging.serviceRole
  }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = value instanceof Error ? value.message : value
  }
  if (err !== undefined) {
    for (const [key, value] of Object.entries(errorFields(err, level))) {
      if (value !== undefined) line[key] = value
    }
  }
  return JSON.stringify(line, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value), config.logging.pretty ? 2 : undefined)
})

/**
 * True when the configuration is valid. The logger is built when this module loads, before index.ts runs
 * config.validate(), so it must not act on bad settings: a NaN LOG_RETENTION_DAYS would make every archive look
 * old enough to delete, and an unknown LOG_LEVEL would make winston drop every line, including the CRITICAL one
 * explaining the exit. With any problem it logs to stdout only, at INFO, until index.ts exits.
 */
const configValid = config.problems().length === 0

/** The file transport when LOG_DIRECTORY is set, kept so flushLogs() can wait for its last writes and archives. */
let fileTransport: DailyFileTransport | null = null
/** Why the log file could not be opened (unwritable LOG_DIRECTORY, ...); index.ts logs it at CRITICAL and exits. */
let fileError: unknown = null

/**
 * Builds the winston transports from the logging config.
 *
 * LOG_DIRECTORY adds the file `<LOG_DIRECTORY>/application.log`, rotated daily into
 * `application-YYYY-MM-DD.log.gz` archives kept LOG_RETENTION_DAYS days (see daily-file-transport.ts);
 * LOG_STDOUT=true adds the console. SILENT=true mutes both. With an invalid configuration, or a log directory that
 * cannot be created, only the console is used, so the CRITICAL line about it still reaches supervisor's log.
 *
 * @returns {winston.transport[]} The transports to log to (possibly empty when muted or logging nowhere).
 */
function transports (): winston.transport[] {
  const { directory, retentionDays, stdout, silent, serviceName, serviceRole } = config.logging
  if (!configValid) return [new winston.transports.Console({ silent })]

  const list: winston.transport[] = []
  if (directory) {
    try {
      fileTransport = new DailyFileTransport({
        filename: path.join(directory, LOG_FILE_NAME),
        retentionDays,
        failureFields: { do_service: serviceName, do_role: serviceRole },
        silent
      })
      list.push(fileTransport)
    } catch (err) {
      fileError = err
      return [new winston.transports.Console({ silent })]
    }
  }
  if (stdout) list.push(new winston.transports.Console({ silent }))
  return list
}

/** The single winston logger behind every module logger; level from LOG_LEVEL, ended by flushLogs(). */
const base = winston.createLogger({
  // Python logging levels, so call sites read logger.warning(...) / logger.critical(...)
  levels: LEVEL_PRIORITIES,
  level: LOG_LEVELS.includes(config.logging.level) ? config.logging.level : 'info',
  format: standardJson,
  transports: transports(),
  silent: config.logging.silent
})

/** Set by flushLogs(): the logger is ended, so later lines (a timer firing during exit) are dropped. */
let ended = false

/**
 * Why the log file could not be opened when the logger loaded, or null when it was opened (or not configured).
 *
 * index.ts checks it after config.validate() and exits with a CRITICAL line, written to stdout instead.
 *
 * @returns {unknown} The error from creating the log directory or file, else null.
 */
export function logFileError (): unknown {
  return fileError
}

/**
 * Module name for a source file, used as the `module` field.
 *
 * The base name without .ts/.js; for an `index` file, the folder name instead (routes/index.ts gives `routes`),
 * except in the source roots src/ and dist/ (ROOT_FOLDERS), where it stays `index`.
 *
 * @param {string} filename - Absolute or relative path of the module file.
 * @returns {string} The module name.
 */
function moduleName (filename: string): string {
  const file = path.basename(filename).replace(/\.(ts|js)$/, '')
  const folder = path.basename(path.dirname(filename))
  return file === 'index' && !ROOT_FOLDERS.has(folder) ? folder : file
}

/**
 * Wraps a winston logger in the Logger interface.
 *
 * Each level method logs through `target`. `forModule` wraps a winston child carrying `module`; `withContext` runs
 * in a merged AsyncLocalStorage context.
 *
 * @param {winston.Logger} target - The winston logger (or child) to write to.
 * @returns {Logger} The wrapped logger.
 */
function wrap (target: winston.Logger): Logger {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    // Writing to an ended winston logger raises "write after end"
    if (!ended) target.log(level, message, fields)
  }
  return {
    debug: write('debug'),
    info: write('info'),
    warning: write('warning'),
    error: write('error'),
    critical: write('critical'),
    forModule: (filename) => wrap(target.child({ module: moduleName(filename) })),
    withContext: (fields, fn) => context.run({ ...context.getStore(), ...fields }, fn)
  }
}

/**
 * Root logger (module `jsonserver`); modules call `forModule(import.meta.filename)` on it instead of using it directly.
 *
 * @example
 *   import rootLogger from './logging/logger.ts'
 *   const logger = rootLogger.forModule(import.meta.filename)
 *   logger.withContext({ request_id }, () => logger.info('Loaded the data file.', { data_file: 'notes' }))
 */
const logger = wrap(base)

/**
 * Flush and close every transport (before process.exit).
 *
 * Ends the shared winston logger, so nothing can be logged afterwards (later lines are dropped), then closes the file transport: its rotation
 * timer stops, application.log is flushed and any archive being gzipped is finished. Call only once, on the way out;
 * index.ts races it against EXIT_FLUSH_TIMEOUT_MS in exitAfterLogging().
 *
 * @returns {Promise<void>} Resolves when every transport has finished writing (the logger's `finish` event) and the
 *   log file and its archives are complete.
 */
export async function flushLogs (): Promise<void> {
  ended = true
  await new Promise<void>((resolve) => {
    base.on('finish', () => resolve())
    base.end()
  })
  if (fileTransport) {
    fileTransport.close()
    await fileTransport.whenClosed
  }
}

export default logger
