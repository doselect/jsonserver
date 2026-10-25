// Entry point: validates the config, builds the app over the data folder, starts the HTTP server, and on
// SIGTERM/SIGINT stops taking connections and lets in-flight requests finish before exiting
import http from 'node:http'
import type { Socket } from 'node:net'
import config, { ConfigError } from './config.ts'
import rootLogger, { flushLogs, logFileError } from './logger.ts'
import createApp, { type JsonServerApp } from './app.ts'
import { HEADERS_TIMEOUT_MS, KEEP_ALIVE_TIMEOUT_MS, MAX_BODY_BYTES, MAX_LIKE_LENGTH } from './constants/http.ts'
import { EXIT_FLUSH_TIMEOUT_MS } from './constants/lifecycle.ts'
import { version } from './utils/version.ts'

/** Logger for this module (`index`). */
const logger = rootLogger.forModule(import.meta.filename)

/** Set once exitAfterLogging() has started, so a second fatal error doesn't exit twice and start() is skipped. */
let exiting = false
/**
 * Exit after giving the log files a moment to flush.
 *
 * Ends the log transports, waiting at most EXIT_FLUSH_TIMEOUT_MS, then calls process.exit. Only the first call does
 * anything; later calls return at once. Log the reason (CRITICAL for a fatal error) before calling it. No logging is
 * possible afterwards.
 *
 * @param {number} code - Process exit code (0 after a clean shutdown, 1 for every fatal error).
 * @returns {Promise<void>} Resolves only for repeated calls; the first call ends the process instead of resolving.
 */
async function exitAfterLogging (code: number): Promise<void> {
  if (exiting) return
  exiting = true
  await Promise.race([flushLogs(), new Promise((resolve) => setTimeout(resolve, EXIT_FLUSH_TIMEOUT_MS))])
  process.exit(code)
}

// Logged as JSON before exiting, as node would
process.on('uncaughtException', (err) => {
  logger.critical('Uncaught exception occurred and the process is exiting.', { err })
  exitAfterLogging(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection occurred.', { err: reason })
})

/**
 * Starts the server: the app over the data folder, the HTTP listener, and the signal handlers.
 *
 * A data folder that cannot be read, or failing to listen (port in use), logs CRITICAL and exits 1. Installs
 * SIGTERM/SIGINT handlers that run a graceful shutdown. Call only after config.validate() succeeded.
 *
 * @returns {void} Nothing; the server keeps running until a signal or a fatal error.
 */
function start (): void {
  let built: JsonServerApp
  try {
    built = createApp()
  } catch (err) {
    logger.critical('Failed to read the data folder.', { data_directory: config.dataDirectory, err })
    exitAfterLogging(1)
    return
  }
  const { app, store } = built

  const server = http.createServer(app)
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS
  server.headersTimeout = HEADERS_TIMEOUT_MS

  // Malformed HTTP (bad headers, oversized header block): answer 400 instead of just dropping the socket
  server.on('clientError', (err: Error, socket: Socket) => {
    logger.debug('Received a malformed HTTP request.', { err })
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
    else socket.destroy()
  })

  server.on('error', function (err) {
    logger.critical('Failed to start the HTTP server.', { port: config.port, err })
    exitAfterLogging(1)
  })

  server.listen(config.port, function () {
    logger.info('Json server started.', {
      version,
      node_version: process.version,
      port: config.port,
      data_directory: store.directory,
      data_file_count: store.names.length,
      log_level: config.logging.level,
      log_directory: config.logging.directory,
      log_retention_days: config.logging.retentionDays,
      max_body_bytes: MAX_BODY_BYTES,
      max_like_length: MAX_LIKE_LENGTH,
      shutdown_timeout_ms: config.shutdownTimeoutMs
    })
  })

  let shuttingDown = false
  /**
   * On SIGTERM (deploy, supervisor restart) or SIGINT (Ctrl+C): stop taking connections, let requests finish, exit.
   *
   * Closes the HTTP server and idle keep-alive sockets, waits for in-flight requests, then exits 0 through
   * exitAfterLogging(), so the shutdown lines still buffered for application.log are written first. A timer exits 1
   * after SHUTDOWN_TIMEOUT_MS if requests take longer. Repeated signals are ignored.
   *
   * @param {NodeJS.Signals} signal - The signal received ('SIGTERM' or 'SIGINT'), logged.
   * @returns {Promise<void>} Resolves only for repeated signals; the first call ends the process via exitAfterLogging().
   */
  async function shutdown (signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Received shutdown signal and stopped accepting connections.', { signal })

    const timeout = setTimeout(() => {
      logger.critical('Graceful shutdown timed out and the process is exiting.', { shutdown_timeout_ms: config.shutdownTimeoutMs })
      exitAfterLogging(1)
    }, config.shutdownTimeoutMs).unref()

    const started = performance.now()
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeIdleConnections()
    await closed
    // Drained in time: the timer must not fire while the logs flush
    clearTimeout(timeout)
    logger.info('Completed graceful shutdown.', { duration_ms: Math.round(performance.now() - started) })
    await exitAfterLogging(0)
  }

  process.on('SIGTERM', (signal) => { shutdown(signal) })
  process.on('SIGINT', (signal) => { shutdown(signal) })
}

try {
  config.validate()
} catch (err) {
  if (!(err instanceof ConfigError)) throw err
  logger.critical('Configuration is invalid.', { validation_errors: err.problems })
  exitAfterLogging(1)
}
// The logger fell back to stdout, which is where this line goes (supervisor's log)
if (!exiting && logFileError()) {
  logger.critical('Failed to open the log file in LOG_DIRECTORY.', { log_directory: config.logging.directory, err: logFileError() })
  exitAfterLogging(1)
}
if (!exiting) start()
