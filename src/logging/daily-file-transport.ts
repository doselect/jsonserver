// Winston transport that always writes to the same file (`application.log`) and rotates it once a day, the same as
// eden's, so the log files match the Django/FastAPI services Filebeat reads:
//   - lines go to <dir>/application.log; the name never has a date
//   - when the server's local date changes, the previous day's lines move to application-YYYY-MM-DD.log.gz (named
//     with the day they were written; -1, -2, ... if that day already has an archive)
//   - rotation runs on the first line of a new day and from a one-minute timer, so quiet days rotate too
//   - at startup, an application.log left from an earlier day (down at midnight) is archived under its mtime's date
//   - archives older than LOG_RETENTION_DAYS are deleted; only files matching that archive pattern are touched
//   - a day file left uncompressed (gzip failed, or the process died during it) is gzipped at startup and on every
//     one-minute check, replacing any partial .gz
//   - failures never stop the server: a write error (disk full, permissions) or a failed rename, gzip or cleanup
//     writes one JSON line to stderr; the file is reopened (or the rotation or gzip retried) on the next one-minute
//     check, and a deleted application.log is recreated there too. Lines written while the file is broken are lost
// Only one process may write the file: supervisor runs a single jsonserver process per host. Several processes writing
// and rotating the same file would race on the rename.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { threadId } from 'node:worker_threads'
import { pipeline } from 'node:stream/promises'
import TransportStream from 'winston-transport'
import { errorCode } from '../utils/errors.ts'
import { asctime } from '../utils/time.ts'
import { DAY_MS, LOG_ROTATE_CHECK_MS } from '../constants/logging.ts'

/** The formatted line winston hands to transports (triple-beam's MESSAGE symbol). */
const MESSAGE = Symbol.for('message')

/** Options winston's base transport accepts (level, silent, format, ...). */
type TransportOptions = TransportStream.TransportStreamOptions

/** Options for {@link DailyFileTransport}. */
export interface DailyFileTransportOptions extends TransportOptions {
  /** Path of the live log file, e.g. `/webapps/jsonserver/logs/application.log`; its directory is created if missing. */
  filename: string
  /**
   * Archives (`<name>-YYYY-MM-DD(-N).log.gz`) whose day is older than this many days are deleted.
   *
   * Must be a positive integer; anything else disables the cleanup, so a bad value can never delete every archive.
   */
  retentionDays: number
  /** Fields added after `message` to the transport's own failure lines on stderr, e.g. do_service and do_role. */
  failureFields?: Record<string, string>
}

/**
 * Formats a date as the server's local calendar day, `YYYY-MM-DD`.
 *
 * Local rather than UTC, so the day boundary is midnight where the server runs, as with the Python services.
 *
 * @param {Date} [date] - The moment to format; defaults to now.
 * @returns {string} The local date, e.g. `2026-10-25`.
 */
export function localDay (date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Winston transport writing every line to a fixed `application.log` and rotating it into gzipped daily archives.
 *
 * @example
 *   const transport = new DailyFileTransport({ filename: '/webapps/jsonserver/logs/application.log', retentionDays: 14 })
 *   winston.createLogger({ format, transports: [transport] })  // winston's Transport is winston-transport
 */
export class DailyFileTransport extends TransportStream {
  /** Path of the live log file. */
  readonly filename: string
  /** Archives older than this many days are deleted after each rotation. */
  readonly retentionDays: number
  /** Local day (`YYYY-MM-DD`) of the lines currently in the live file; a different `localDay()` means rotate. */
  day: string
  /** File name without extension (`application`), the prefix of every archive. */
  readonly #base: string
  /** Extra fields for failure lines on stderr. */
  readonly #failureFields: Record<string, string>
  /** Append stream to the live file; replaced on every rotation and after a write error. */
  #stream: fs.WriteStream | null = null
  /** The one-minute check: rotation, and reopening a broken or deleted file. */
  readonly #timer: NodeJS.Timeout
  /** After a failed rename, rotateIfNewDay() waits until this time (ms since epoch) before trying again. */
  #retryRotationAt = 0
  /** Set when a write failed and reported, so a broken file is reported once, not on every line. */
  #broken = false
  /** Compression and cleanup still running, so close() can wait for them. */
  #pending: Promise<void> = Promise.resolve()
  /** Day files a rotation renamed and has not gzipped yet; recoverArchives() leaves them to it. */
  readonly #rotating = new Set<string>()
  /** Set while a recoverArchives() run is queued, so the one-minute check does not queue another. */
  #recoveryQueued = false
  /** Set when an archive job failed and reported, so a failure that repeats every minute is reported once. */
  #archiveFailing = false
  /** Set once close() ran; a second call does nothing. */
  #closing = false
  /** Resolves when close() has ended the stream and every pending archive job has settled. */
  readonly whenClosed: Promise<void>
  /** Resolves `whenClosed`. */
  #resolveClosed: () => void = () => {}

  /**
   * Opens (or creates) the live file, first archiving one left from an earlier day, and starts the one-minute check.
   *
   * @param {DailyFileTransportOptions} options - Winston transport options plus the file name and retention.
   * @param {string} options.filename - Path of the live log file; its directory is created if missing.
   * @param {number} options.retentionDays - Delete archives older than this many days.
   * @param {Record<string, string>} [options.failureFields] - Extra fields for failure lines on stderr.
   * @throws {Error} When the log directory cannot be created or application.log cannot be opened for writing (EACCES,
   *   ENOTDIR, EISDIR, ...); the logger then uses stdout and index.ts exits.
   */
  constructor ({ filename, retentionDays, failureFields = {}, ...options }: DailyFileTransportOptions) {
    super(options)
    this.filename = filename
    this.retentionDays = retentionDays
    this.#base = path.basename(filename, path.extname(filename))
    this.#failureFields = failureFields
    this.whenClosed = new Promise<void>((resolve) => { this.#resolveClosed = resolve })
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    fs.accessSync(path.dirname(filename), fs.constants.W_OK)

    // A file left from an earlier day (the server was down at midnight) is archived under the day it was last written
    let stat: fs.Stats | null = null
    try {
      stat = fs.statSync(filename)
    } catch (err) {
      if (errorCode(err) !== 'ENOENT') this.reportFailure('Failed to read the log file at startup.', err)
    }
    this.day = stat ? localDay(stat.mtime) : localDay()
    this.rotateIfNewDay()
    // Opened synchronously so a file that cannot be written (owned by another user, a directory) fails startup here,
    // instead of in a stream error after the server is already listening
    this.#stream = this.#open(fs.openSync(filename, 'a'))
    this.#queueRecovery()

    // Also rotates on days with no log lines; unref so the timer never keeps the process alive
    this.#timer = setInterval(() => this.check(), LOG_ROTATE_CHECK_MS).unref()
  }

  /**
   * Reports a failure of the transport itself on stderr, as one JSON line in the logging standard's shape.
   *
   * The transport cannot log its own failures to the file (they may be the reason it is not writable), so they go to
   * stderr, which supervisor keeps in jsonserver_supervisor.log. Never throws.
   *
   * @param {string} message - Complete sentence describing what failed.
   * @param {unknown} err - The error that caused it.
   * @returns {void}
   */
  reportFailure (message: string, err: unknown): void {
    const line = {
      levelname: 'ERROR',
      asctime: asctime(),
      module: 'daily-file-transport',
      process: process.pid,
      thread: threadId,
      message,
      ...this.#failureFields,
      log_file: this.filename,
      error: err instanceof Error ? err.message : String(err),
      error_code: errorCode(err)
    }
    process.stderr.write(`${JSON.stringify(line)}\n`)
  }

  /**
   * Opens an append stream to the live file, creating it if missing.
   *
   * A write or open error (disk full, permissions) is reported once on stderr and destroys the stream; it never
   * becomes an uncaught exception. check() reopens a destroyed stream within a minute.
   *
   * @param {number} [fd] - A descriptor already opened on the live file (in append mode); else the stream opens it.
   * @returns {fs.WriteStream} The new stream.
   */
  #open (fd?: number): fs.WriteStream {
    const stream = fs.createWriteStream(this.filename, { flags: 'a', fd })
    stream.on('error', (err) => {
      if (!this.#broken) this.reportFailure('Failed to write the log file and will reopen it within a minute.', err)
      this.#broken = true
    })
    return stream
  }

  /**
   * Swaps in a new stream to the live file and ends the old one, which flushes its pending writes.
   *
   * @returns {Promise<void>} Resolves when the old stream has finished (at once when there was none).
   */
  #reopen (): Promise<void> {
    const previous = this.#stream
    this.#stream = this.#open()
    return previous ? new Promise<void>((resolve) => previous.end(resolve)) : Promise.resolve()
  }

  /**
   * The one-minute check: rotates on a new day, and reopens the file when its stream broke or it was deleted.
   *
   * @returns {void}
   */
  check (): void {
    if (this.#closing) return
    this.rotateIfNewDay()
    if (this.#stream?.destroyed || !fs.existsSync(this.filename)) this.#reopen().catch(() => {})
    this.#queueRecovery()
  }

  /**
   * Runs an archive job (gzip, cleanup) after the ones already queued, reporting a failure on stderr.
   *
   * A failure is reported once; after a job succeeds the next failure is reported again. Never rejects.
   *
   * @param {() => Promise<void>} job - The work to run.
   * @returns {void}
   */
  #queueArchiveJob (job: () => Promise<void>): void {
    this.#pending = this.#pending.then(job).then(
      () => { this.#archiveFailing = false },
      (err: unknown) => {
        if (!this.#archiveFailing) this.reportFailure('Failed to compress or clean up rotated log files and will retry within a minute.', err)
        this.#archiveFailing = true
      })
  }

  /**
   * Queues a recoverArchives() run, unless one is already waiting.
   *
   * @returns {void}
   */
  #queueRecovery (): void {
    if (this.#recoveryQueued) return
    this.#recoveryQueued = true
    this.#queueArchiveJob(async () => {
      this.#recoveryQueued = false
      // Not on the way out: close() waits for the queue, and exit has only EXIT_FLUSH_TIMEOUT_MS
      if (!this.#closing) await this.recoverArchives()
    })
  }

  /**
   * Gzips every day file left uncompressed (`<name>-YYYY-MM-DD(-N).log`), then deletes archives past retention.
   *
   * Such a file remains when gzip failed (disk full) or the process stopped during it; a partial `.gz` next to it
   * is replaced. Files a rotation is still writing or compressing are skipped.
   *
   * @returns {Promise<void>} Resolves when every leftover day file is gzipped and old archives are gone.
   * @throws {Error} Directory read, gzip or unlink errors; the caller reports them.
   */
  async recoverArchives (): Promise<void> {
    const dir = path.dirname(this.filename)
    const pattern = new RegExp(`^${this.#base}-\\d{4}-\\d{2}-\\d{2}(-\\d+)?\\.log$`)
    let files: string[]
    try {
      files = await fs.promises.readdir(dir)
    } catch (err) {
      // The folder is gone: nothing to recover, and the failed reopen of application.log is already reported
      if (errorCode(err) === 'ENOENT') return
      throw err
    }
    for (const file of files) {
      const archive = path.join(dir, file)
      if (pattern.test(file) && !this.#rotating.has(archive)) await this.compress(archive)
    }
    await this.deleteOldArchives()
  }

  /**
   * Writes one formatted line to the live file, rotating first when the day has changed.
   *
   * Called by winston for every log entry at or above this transport's level. While the stream is broken the line is
   * dropped (the failure was reported on stderr).
   *
   * @param {Record<string | symbol, unknown>} info - The log entry; the formatted line is `info[Symbol.for('message')]`.
   * @param {() => void} callback - Called once the line is handed to the file stream (or dropped).
   * @returns {void}
   */
  override log (info: Record<string | symbol, unknown>, callback: () => void): void {
    this.rotateIfNewDay()
    const stream = this.#stream
    if (!stream || stream.destroyed) {
      callback()
      return
    }
    const line = info[MESSAGE]
    stream.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`, (err) => {
      // A line got through after a failure: the file works again, so the next failure is reported
      if (!err) this.#broken = false
      this.emit('logged', info)
      callback()
    })
  }

  /**
   * Rotates the live file when the local day differs from {@link DailyFileTransport.day}.
   *
   * Renames `application.log` to `application-<day>.log` and opens a new `application.log`, both synchronously and one
   * right after the other, so no line is written between the two steps. The old stream still points at the renamed
   * file; it is ended first so its pending writes land in the archive, then the file is gzipped and old archives are
   * deleted. A missing file (ENOENT, deleted by someone) means there is nothing to archive: a new file is opened.
   * Any other rename failure is reported on stderr, the day is kept, and the rotation is retried after a minute, so
   * the new day's lines go to the current file meanwhile (and end up in the old day's archive).
   *
   * @returns {void}
   */
  rotateIfNewDay (): void {
    const today = localDay()
    if (today === this.day || this.#closing || Date.now() < this.#retryRotationAt) return

    const archive = this.archivePath(this.day)
    try {
      fs.renameSync(this.filename, archive)
    } catch (err) {
      if (errorCode(err) === 'ENOENT') {
        this.day = today
        if (this.#stream) this.#reopen().catch(() => {})
        return
      }
      this.reportFailure('Failed to rotate the log file and will retry within a minute.', err)
      this.#retryRotationAt = Date.now() + LOG_ROTATE_CHECK_MS
      return
    }
    this.day = today
    this.#retryRotationAt = 0
    this.#rotating.add(archive)

    // At startup there is no stream yet; otherwise the old one finishes its pending writes first. A failed gzip
    // leaves the day file for recoverArchives() to retry on the next check
    const ended = this.#stream ? this.#reopen() : Promise.resolve()
    this.#queueArchiveJob(async () => {
      try {
        await ended
        await this.compress(archive)
      } finally {
        this.#rotating.delete(archive)
      }
      await this.deleteOldArchives()
    })
  }

  /**
   * Path for a day's archive before compression: `<name>-YYYY-MM-DD.log`, or with `-1`, `-2`, ... when that day
   * already has one (plain or gzipped), e.g. the day was rotated before.
   *
   * @param {string} date - The local day the lines were written, `YYYY-MM-DD`.
   * @returns {string} A path in the log directory that is not taken yet.
   */
  archivePath (date: string): string {
    const dir = path.dirname(this.filename)
    let candidate = path.join(dir, `${this.#base}-${date}.log`)
    for (let n = 1; fs.existsSync(candidate) || fs.existsSync(`${candidate}.gz`); n++) {
      candidate = path.join(dir, `${this.#base}-${date}-${n}.log`)
    }
    return candidate
  }

  /**
   * Gzips a rotated file to `<file>.gz` and removes the uncompressed file.
   *
   * @param {string} file - The renamed day file, e.g. `application-2026-10-24.log`.
   * @returns {Promise<void>} Resolves when the archive is written and the original removed.
   * @throws {Error} Read, write or unlink errors; the caller reports them.
   */
  async compress (file: string): Promise<void> {
    await pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(`${file}.gz`))
    await fs.promises.unlink(file)
  }

  /**
   * Deletes archives whose day is more than `retentionDays` ago.
   *
   * Only names matching `<name>-YYYY-MM-DD.log.gz` or `<name>-YYYY-MM-DD-N.log.gz` are considered; every other file
   * in the directory is left alone. Does nothing unless `retentionDays` is a positive integer: NaN or 0 would put
   * the cutoff after every archive and delete them all.
   *
   * @returns {Promise<void>} Resolves when the old archives are gone.
   * @throws {Error} Directory read or unlink errors; the caller reports them.
   */
  async deleteOldArchives (): Promise<void> {
    if (!Number.isInteger(this.retentionDays) || this.retentionDays < 1) return
    const dir = path.dirname(this.filename)
    const pattern = new RegExp(`^${this.#base}-(\\d{4}-\\d{2}-\\d{2})(-\\d+)?\\.log\\.gz$`)
    const oldest = localDay(new Date(Date.now() - this.retentionDays * DAY_MS))
    for (const file of await fs.promises.readdir(dir)) {
      const match = pattern.exec(file)
      if (match?.[1] !== undefined && match[1] < oldest) await fs.promises.unlink(path.join(dir, file))
    }
  }

  /**
   * Stops the one-minute check and ends the file stream; {@link DailyFileTransport.whenClosed} resolves once the
   * stream has flushed and any compression or cleanup in progress has settled. Safe to call more than once.
   *
   * @returns {void}
   */
  override close (): void {
    if (this.#closing) return
    this.#closing = true
    clearInterval(this.#timer)
    const stream = this.#stream
    const ended = stream && !stream.destroyed ? new Promise<void>((resolve) => stream.end(resolve)) : Promise.resolve()
    ended
      .then(() => this.#pending)
      .then(() => this.#resolveClosed(), () => this.#resolveClosed())
  }
}
