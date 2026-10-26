// The logger (src/logging/logger.ts) and the DoSelect logging standard it implements: flat JSON lines with a fixed leading
// field order, error expansion (`error`, `error_type`, `error_code`, `exc_value`, and `exc_info` from ERROR up),
// stdout and file output (a fixed application.log, rotated daily into application-YYYY-MM-DD.log.gz with retention),
// SILENT, and the CRITICAL line plus exit code 1 on invalid config at boot.
// Each case runs a generated script (or src/index.ts) in a child Node process, since the logger is configured from
// the environment when it loads. The last case is a static check over every log call in src/: it fails the build
// when a message or field name breaks the style.
import { it } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { execFileSync, spawnSync } from 'node:child_process'
import { localDay } from '../src/logging/daily-file-transport.ts'

/** Repository root: the child process's working directory. */
const ROOT = path.join(import.meta.dirname, '..')
/** The src/ directory: where src/index.ts is run from, and the tree the style check scans. */
const SRC = path.join(ROOT, 'src')
/** Absolute path of src/logging/logger.ts as a JS string literal, for interpolation into the temp script. */
const LOGGER = JSON.stringify(path.join(SRC, 'logging', 'logger.ts'))

/** Absolute path of src/logging/daily-file-transport.ts as a JS string literal, for interpolation into the temp script. */
const TRANSPORT = JSON.stringify(path.join(SRC, 'logging', 'daily-file-transport.ts'))
/** One day in milliseconds, for building dates relative to today. */
const DAY = 24 * 60 * 60 * 1000

/** One parsed log line: a flat object of field name to value. */
type LogLine = Record<string, unknown>

/**
 * Run `body` in a fresh Node process with the logger imported, and return what it wrote to stdout.
 *
 * The logger is configured from the environment when it loads, so each case runs in its own process (node runs the
 * .ts directly). The script can use `logger` and `flushLogs`; logs are flushed before it exits. The temp directory
 * is removed afterwards.
 *
 * @param {string} body - Script statements to run after the logger is imported.
 * @param {Record<string, string>} env - Environment for the child; only PATH is added.
 * @returns {string} The child's stdout (one JSON line per log line written to stdout).
 * @throws {Error} When the child process exits non-zero (execFileSync).
 */
function runScript (body: string, env: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonserver-logger-'))
  // .mts: ESM (top-level await) even though the temp dir has no package.json
  const file = path.join(dir, 'script.mts')
  fs.writeFileSync(file, `
    import { default as logger, flushLogs } from ${LOGGER}
    ${body}
    await flushLogs()
  `)
  try {
    return execFileSync(process.execPath, [file], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Parse newline-separated JSON log output into objects.
 *
 * @param {string} out - Log output, one JSON object per line; surrounding whitespace is ignored.
 * @returns {LogLine[]} One object per line, in order.
 * @throws {SyntaxError} When a line is not valid JSON (including empty output).
 */
function parseLines (out: string): LogLine[] {
  return out.trim().split('\n').map((line) => JSON.parse(line) as LogLine)
}

/**
 * Log a fixed sample in a child process configured by `env`, and return its stdout.
 *
 * Inside a request context (`request_id`), as module `data-store`: an INFO line with fields, a WARNING and an
 * ERROR with the same ENOENT error, and a DEBUG line that INFO level hides.
 *
 * @param {Record<string, string>} env - Logger settings for the child, e.g. LOG_LEVEL, LOG_STDOUT, LOG_DIRECTORY.
 * @returns {string} The child's stdout; empty when stdout logging is off or SILENT is set.
 * @throws {Error} When the child process exits non-zero (execFileSync).
 */
function logIn (env: Record<string, string>): string {
  return runScript(`
    const log = logger.forModule('/app/src/services/data-store.ts')
    log.withContext({ request_id: 'req-1' }, () => {
      log.info('Loaded the data file into memory.', { data_file: 'notes', load_time_ms: 12 })
      const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      log.warning('Failed to read the data file and will retry.', { err })
      log.error('Failed to load the data file.', { err })
      log.debug('Hidden at INFO level.')
    })
  `, env)
}

it('writes flat JSON lines in the DoSelect logging standard field order', () => {
  const [info, warning, error] = parseLines(logIn({ LOG_LEVEL: 'INFO', LOG_STDOUT: 'true' }))
  assert.ok(info && warning && error)

  assert.deepEqual(Object.keys(info).slice(0, 8), ['levelname', 'asctime', 'module', 'process', 'thread', 'message', 'do_service', 'do_role'])
  assert.equal(info.levelname, 'INFO')
  assert.match(String(info.asctime), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/)
  assert.equal(info.module, 'data-store')
  assert.equal(typeof info.process, 'number')
  assert.equal(info.thread, 0)
  assert.equal(info.do_service, 'jsonserver')
  assert.equal(info.do_role, 'jsonserver')
  assert.equal(info.request_id, 'req-1')
  assert.equal(info.data_file, 'notes')
  assert.equal(info.load_time_ms, 12)

  assert.equal(warning.levelname, 'WARNING')
  assert.equal(warning.error, 'ENOENT: no such file')
  assert.equal(warning.error_type, 'Error')
  assert.equal(warning.error_code, 'ENOENT')
  assert.equal(warning.exc_value, 'ENOENT: no such file')
  assert.equal(warning.exc_info, undefined, 'no stack trace below ERROR')

  assert.equal(error.levelname, 'ERROR')
  assert.match(String(error.exc_info), /^Error: ENOENT: no such file\n\s+at /)
  assert.equal(error.err, undefined)
})

it('expands an Error passed as `error` like `err`, and keeps the content of non-Error values', () => {
  const out = runScript(`
    const log = logger.forModule('/app/src/routes/data.ts')
    log.error('Failed with error key.', { error: new TypeError('bad input') })
    log.error('Failed with a plain object.', { err: { code: 'E_PLAIN', detail: 'x' } })
    log.error('Failed with a string.', { err: 'just text' })
  `, { LOG_STDOUT: 'true' })
  const [errorKey, plain, text] = parseLines(out)
  assert.ok(errorKey && plain && text)

  assert.equal(errorKey.error, 'bad input')
  assert.equal(errorKey.error_type, 'TypeError')
  assert.match(String(errorKey.exc_info), /^TypeError: bad input/)
  assert.equal(plain.error, '{"code":"E_PLAIN","detail":"x"}')
  assert.equal(text.error, 'just text')
})

it('logs bad config as CRITICAL JSON and exits with 1', () => {
  let status = 0
  let stdout = ''
  try {
    execFileSync(process.execPath, [path.join(SRC, 'index.ts')], { cwd: ROOT, env: { PATH: process.env.PATH, LOG_STDOUT: 'true', LOG_RETENTION_DAYS: '0', PORT: 'abc' }, encoding: 'utf8' })
  } catch (err) {
    const failure = err as { status: number, stdout: string }
    status = failure.status
    stdout = failure.stdout
  }
  assert.equal(status, 1)
  const [first] = parseLines(stdout)
  assert.ok(first)
  assert.equal(first.levelname, 'CRITICAL')
  assert.equal(first.message, 'Configuration is invalid.')
  assert.ok((first.validation_errors as string[]).includes('PORT must be an integer from 1 to 65535'))
  assert.ok((first.validation_errors as string[]).includes('LOG_RETENTION_DAYS must be a positive integer'))
})

/**
 * Make an empty temp directory for log files.
 *
 * @returns {string} Absolute path of the new directory; the caller removes it.
 */
function logDir (): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsonserver-logs-'))
}

/**
 * Read a log file (gzipped when it ends in .gz) and return its non-empty lines.
 *
 * @param {string} file - Path of `application.log` or an `application-YYYY-MM-DD.log.gz` archive.
 * @returns {string[]} The lines, in order.
 */
function readLines (file: string): string[] {
  const data = fs.readFileSync(file)
  const text = file.endsWith('.gz') ? zlib.gunzipSync(data).toString('utf8') : data.toString('utf8')
  return text.split('\n').filter((line) => line.length > 0)
}

/**
 * Leave an `application.log` from an earlier day in `dir`, as after a server that was down at midnight.
 *
 * @param {string} dir - The log directory.
 * @param {string} content - The file's lines, newline-terminated.
 * @param {Date} mtime - Its last-modified time, which decides the archive's day.
 * @returns {void}
 */
function staleLog (dir: string, content: string, mtime: Date): void {
  const file = path.join(dir, 'application.log')
  fs.writeFileSync(file, content)
  fs.utimesSync(file, mtime, mtime)
}

it('writes application.log in LOG_DIRECTORY, and nothing when SILENT=true', () => {
  const dir = logDir()
  try {
    assert.equal(logIn({ LOG_STDOUT: 'false', LOG_DIRECTORY: dir, SERVICE_NAME: 'jsonserver-test', SERVICE_ROLE: 'jsonserver-worker' }), '')
    // One file, always the same name: no date in it and no archive on the first day
    assert.deepEqual(fs.readdirSync(dir), ['application.log'])
    const lines = parseLines(fs.readFileSync(path.join(dir, 'application.log'), 'utf8'))
    assert.equal(lines.length, 3)
    assert.equal(lines[0]?.do_service, 'jsonserver-test')
    assert.equal(lines[0]?.do_role, 'jsonserver-worker')

    assert.equal(logIn({ LOG_STDOUT: 'true', SILENT: 'true' }), '')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('moves the previous day to application-<day>.log.gz on the first line of a new day, losing no line', () => {
  const dir = logDir()
  const yesterday = localDay(new Date(Date.now() - DAY))
  const LINES = 20000
  try {
    // Lines go straight to the transport so their order around the day change is exact. Once the file is open, ~2 MB
    // of lines are written and the day changes at once, while most are still buffered in the old stream: they must
    // reach the archive (the old stream is ended before the gzip), and nothing may be lost or land in the new file
    const file = path.join(dir, 'application.log')
    const script = path.join(dir, 'rotate.mts')
    fs.writeFileSync(script, `
      import fs from 'node:fs'
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      const write = (text) => transport.log({ [Symbol.for('message')]: text }, () => {})
      write('before-0')
      while (!fs.existsSync(${JSON.stringify(file)})) await new Promise((resolve) => setTimeout(resolve, 5))
      for (let i = 1; i <= ${LINES}; i++) write('before-' + i + ' ' + 'x'.repeat(90))
      transport.day = ${JSON.stringify(yesterday)}
      for (let i = 1; i <= 3; i++) write('after-' + i)
      transport.close()
      await transport.whenClosed
    `)
    execFileSync(process.execPath, [script], { cwd: ROOT, env: { PATH: process.env.PATH }, encoding: 'utf8' })
    fs.rmSync(script)

    assert.deepEqual(fs.readdirSync(dir).sort(), [`application-${yesterday}.log.gz`, 'application.log'])
    assert.deepEqual(readLines(path.join(dir, `application-${yesterday}.log.gz`)), Array.from({ length: LINES + 1 }, (_, i) => i === 0 ? 'before-0' : `before-${i} ${'x'.repeat(90)}`))
    assert.deepEqual(readLines(path.join(dir, 'application.log')), ['after-1', 'after-2', 'after-3'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('archives an application.log left from an earlier day under its mtime date before writing', () => {
  const dir = logDir()
  const twoDaysAgo = new Date(Date.now() - 2 * DAY)
  const day = localDay(twoDaysAgo)
  try {
    staleLog(dir, 'line from the old day\n', twoDaysAgo)
    logIn({ LOG_STDOUT: 'false', LOG_DIRECTORY: dir })

    assert.deepEqual(fs.readdirSync(dir).sort(), [`application-${day}.log.gz`, 'application.log'])
    assert.deepEqual(readLines(path.join(dir, `application-${day}.log.gz`)), ['line from the old day'])
    assert.equal(parseLines(fs.readFileSync(path.join(dir, 'application.log'), 'utf8')).length, 3)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('deletes archives older than LOG_RETENTION_DAYS, uncompressed ones too, and keeps newer ones and unrelated files', () => {
  const dir = logDir()
  const daysAgo = (n: number): string => localDay(new Date(Date.now() - n * DAY))
  const old = daysAgo(20)
  const recent = daysAgo(3)
  const yesterday = daysAgo(1)
  try {
    const kept = [`application-${recent}.log.gz`, 'notes.txt', `application-${old}.txt`, `other-${old}.log.gz`]
    // An old day file left uncompressed (gzip kept failing) expires like its .gz would
    const expired = [`application-${old}.log.gz`, `application-${old}-1.log.gz`, `application-${old}-2.log`]
    for (const name of [...expired, ...kept]) fs.writeFileSync(path.join(dir, name), 'x')
    // Cleanup runs after a rotation; a stale file makes one happen at startup
    staleLog(dir, 'yesterday\n', new Date(Date.now() - DAY))
    logIn({ LOG_STDOUT: 'false', LOG_DIRECTORY: dir, LOG_RETENTION_DAYS: '14' })

    assert.deepEqual(fs.readdirSync(dir).sort(), [...kept, `application-${yesterday}.log.gz`, 'application.log'].sort())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

/** What a child process wrote and how it ended. */
interface ChildResult {
  /** Exit code (null when killed by a signal). */
  status: number | null
  /** Everything written to stdout. */
  stdout: string
  /** Everything written to stderr. */
  stderr: string
}

/**
 * Run src/index.ts with `env` (plus PATH) and wait for it to exit; for configurations that stop it at boot.
 *
 * @param {Record<string, string>} env - Environment for the child.
 * @returns {ChildResult} Exit code and output.
 */
function runServer (env: Record<string, string>): ChildResult {
  const result = spawnSync(process.execPath, [path.join(SRC, 'index.ts')], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 10000 })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a script with the transport and the logger importable as `TRANSPORT` / `LOGGER` paths, and wait for it.
 *
 * @param {string} dir - Directory to write the script into (removed by the caller).
 * @param {string} body - The script (ESM, top-level await allowed).
 * @returns {ChildResult} Exit code and output.
 */
function runModule (dir: string, body: string): ChildResult {
  const script = path.join(dir, 'script.mts')
  fs.writeFileSync(script, body)
  const result = spawnSync(process.execPath, [script], { cwd: ROOT, env: { PATH: process.env.PATH, LOG_STDOUT: 'true' }, encoding: 'utf8', timeout: 10000 })
  fs.rmSync(script)
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

it('never deletes archives when LOG_RETENTION_DAYS is invalid, and still explains the exit', () => {
  const dir = logDir()
  try {
    const archives = ['application-2026-01-01.log.gz', 'application-2026-01-02.log.gz']
    for (const name of archives) fs.writeFileSync(path.join(dir, name), 'x')
    staleLog(dir, 'old day\n', new Date(Date.now() - 2 * DAY))

    for (const retention of ['abc', '0']) {
      const { status, stdout } = runServer({ LOG_DIRECTORY: dir, LOG_STDOUT: 'false', LOG_RETENTION_DAYS: retention })
      assert.equal(status, 1)
      const [line] = parseLines(stdout)
      assert.equal(line?.message, 'Configuration is invalid.', 'written to stdout even with LOG_STDOUT=false')
      assert.ok((line?.validation_errors as string[]).includes('LOG_RETENTION_DAYS must be a positive integer'))
    }
    // The bad setting never reached the file transport: no rotation, no cleanup
    assert.deepEqual(fs.readdirSync(dir).sort(), [...archives, 'application.log'].sort())
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('writes the CRITICAL line for an unknown LOG_LEVEL instead of exiting silently', () => {
  const { status, stdout } = runServer({ LOG_STDOUT: 'true', LOG_LEVEL: 'verbose' })
  assert.equal(status, 1)
  const [line] = parseLines(stdout)
  assert.equal(line?.levelname, 'CRITICAL')
  assert.ok((line?.validation_errors as string[]).includes('LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL'))
})

it('rejects PORT 0 and SHUTDOWN_TIMEOUT_MS 0', () => {
  const { status, stdout } = runServer({ LOG_STDOUT: 'true', PORT: '0', SHUTDOWN_TIMEOUT_MS: '0' })
  assert.equal(status, 1)
  const errors = parseLines(stdout)[0]?.validation_errors as string[]
  assert.ok(errors.includes('PORT must be an integer from 1 to 65535'))
  assert.ok(errors.includes('SHUTDOWN_TIMEOUT_MS must be a positive integer'))
})

it('exits with a CRITICAL line on stdout when LOG_DIRECTORY cannot be used', () => {
  const dir = logDir()
  try {
    // A directory below a regular file can never be created, even as root
    fs.writeFileSync(path.join(dir, 'file'), '')
    const { status, stdout, stderr } = runServer({ LOG_DIRECTORY: path.join(dir, 'file', 'logs'), LOG_STDOUT: 'false' })
    assert.equal(status, 1)
    assert.equal(stderr, '')
    const [line] = parseLines(stdout)
    assert.equal(line?.message, 'Failed to open the log file in LOG_DIRECTORY.')
    assert.equal(line?.error_code, 'ENOTDIR')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('exits with a CRITICAL line on stdout when application.log itself cannot be opened', () => {
  const dir = logDir()
  try {
    // The folder is writable but application.log is a directory: opening it fails even as root
    fs.mkdirSync(path.join(dir, 'application.log'))
    const { status, stdout } = runServer({ LOG_DIRECTORY: dir, LOG_STDOUT: 'false' })
    assert.equal(status, 1)
    const [line] = parseLines(stdout)
    assert.equal(line?.message, 'Failed to open the log file in LOG_DIRECTORY.')
    assert.equal(line?.error_code, 'EISDIR')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('gzips a day file left uncompressed at startup, replacing a partial archive', () => {
  const dir = logDir()
  const file = path.join(dir, 'application.log')
  try {
    // As after a crash during gzip: the renamed day file and a truncated .gz beside it
    fs.writeFileSync(path.join(dir, 'application-2099-01-01.log'), 'kept-1\nkept-2\n')
    fs.writeFileSync(path.join(dir, 'application-2099-01-01.log.gz'), zlib.gzipSync('kept-1\n').subarray(0, 10))
    const { status, stderr } = runModule(dir, `
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      transport.close()
      await transport.whenClosed
    `)
    assert.equal(status, 0, stderr)
    assert.equal(stderr, '')
    assert.deepEqual(fs.readdirSync(dir).sort(), ['application-2099-01-01.log.gz', 'application.log'])
    assert.deepEqual(readLines(path.join(dir, 'application-2099-01-01.log.gz')), ['kept-1', 'kept-2'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('retries a failed gzip on the next check and reports the failure once', () => {
  const dir = logDir()
  const file = path.join(dir, 'application.log')
  const yesterday = localDay(new Date(Date.now() - DAY))
  const blocker = path.join(dir, `application-${yesterday}-1.log.gz`)
  try {
    // An earlier archive for yesterday, so the rotation writes -1; a directory in the way makes its gzip fail
    fs.writeFileSync(path.join(dir, `application-${yesterday}.log.gz`), zlib.gzipSync('earlier\n'))
    const { status, stderr } = runModule(dir, `
      import fs from 'node:fs'
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      const write = (text) => new Promise((resolve) => transport.log({ [Symbol.for('message')]: text }, resolve))
      const tick = () => new Promise((resolve) => setTimeout(resolve, 100))
      await tick()
      await write('yesterday')
      transport.day = ${JSON.stringify(yesterday)}
      // After the rename picked the -1 name: its .gz is now blocked
      const rotate = transport.rotateIfNewDay.bind(transport)
      transport.rotateIfNewDay = () => {
        rotate()
        transport.rotateIfNewDay = rotate
        fs.mkdirSync(${JSON.stringify(blocker)})
      }
      await write('today')
      await tick()
      transport.check()
      await tick()
      fs.rmdirSync(${JSON.stringify(blocker)})
      transport.check()
      await tick()
      transport.close()
      await transport.whenClosed
    `)
    assert.equal(status, 0, stderr)
    const failures = stderr.trim().split('\n').map((line) => JSON.parse(line) as LogLine)
    assert.equal(failures.length, 1, 'reported once, not on every check')
    assert.equal(failures[0]?.message, 'Failed to compress or clean up rotated log files and will retry within a minute.')
    assert.equal(failures[0]?.error_code, 'EISDIR')
    assert.deepEqual(fs.readdirSync(dir).sort(), [`application-${yesterday}-1.log.gz`, `application-${yesterday}.log.gz`, 'application.log'])
    assert.deepEqual(readLines(blocker), ['yesterday'])
    assert.deepEqual(readLines(file), ['today'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('survives a log file that cannot be written, reports it once, and recovers', () => {
  const dir = logDir()
  const logs = path.join(dir, 'logs')
  const file = path.join(logs, 'application.log')
  try {
    const { status, stderr } = runModule(dir, `
      import fs from 'node:fs'
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      const write = (text) => new Promise((resolve) => transport.log({ [Symbol.for('message')]: text }, resolve))
      const tick = () => new Promise((resolve) => setTimeout(resolve, 50))
      await write('before')
      // The folder disappears: reopening the file fails (as with a full disk or lost permissions)
      fs.rmSync(${JSON.stringify(logs)}, { recursive: true })
      transport.check()
      await tick()
      for (let i = 0; i < 5; i++) await write('lost-' + i)
      // Fixed: the next check reopens the file
      fs.mkdirSync(${JSON.stringify(logs)})
      transport.check()
      await tick()
      await write('after')
      transport.close()
      await transport.whenClosed
    `)
    assert.equal(status, 0, stderr)
    const failures = stderr.trim().split('\n').map((line) => JSON.parse(line) as LogLine)
    assert.equal(failures.length, 1, 'reported once, not per line')
    assert.equal(failures[0]?.message, 'Failed to write the log file and will reopen it within a minute.')
    assert.equal(failures[0]?.error_code, 'ENOENT')
    assert.deepEqual(readLines(file), ['after'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('recreates a deleted application.log, during the day and at the day change', () => {
  const dir = logDir()
  const file = path.join(dir, 'application.log')
  const yesterday = localDay(new Date(Date.now() - DAY))
  try {
    const { status, stderr } = runModule(dir, `
      import fs from 'node:fs'
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      const write = (text) => new Promise((resolve) => transport.log({ [Symbol.for('message')]: text }, resolve))
      await write('first')
      fs.rmSync(${JSON.stringify(file)})
      transport.check()
      await write('during-the-day')
      fs.rmSync(${JSON.stringify(file)})
      transport.day = ${JSON.stringify(yesterday)}
      await write('new-day')
      transport.close()
      await transport.whenClosed
    `)
    assert.equal(status, 0, stderr)
    assert.equal(stderr, '')
    assert.deepEqual(fs.readdirSync(dir).sort(), ['application.log'])
    assert.deepEqual(readLines(file), ['new-day'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('drops lines logged after flushLogs() instead of raising write-after-end errors', () => {
  const dir = logDir()
  try {
    const { status, stdout, stderr } = runModule(dir, `
      import { default as logger, flushLogs } from ${LOGGER}
      logger.info('Logged before the flush.')
      const flushed = flushLogs()
      logger.critical('Logged while flushing.')
      await flushed
      logger.info('Logged after the flush.')
    `)
    assert.equal(status, 0)
    assert.equal(stderr, '')
    assert.deepEqual(parseLines(stdout).map((line) => line.message), ['Logged before the flush.'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('writes DEBUG lines only at LOG_LEVEL=DEBUG, and accepts WARN as WARNING', () => {
  const debug = parseLines(logIn({ LOG_LEVEL: 'DEBUG', LOG_STDOUT: 'true' }))
  assert.deepEqual(debug.map((line) => line.levelname), ['INFO', 'WARNING', 'ERROR', 'DEBUG'])
  const warn = parseLines(logIn({ LOG_LEVEL: 'WARN', LOG_STDOUT: 'true' }))
  assert.deepEqual(warn.map((line) => line.levelname), ['WARNING', 'ERROR'])
})

it('indents lines with LOG_PRETTY=true and writes bigints as strings', () => {
  const out = runScript(`
    logger.info('Counted a large number.', { total: 12345678901234567890n })
  `, { LOG_STDOUT: 'true', LOG_PRETTY: 'true' })
  assert.match(out, /^\{\n {2}"levelname": "INFO",/)
  const line = JSON.parse(out) as LogLine
  assert.equal(line.total, '12345678901234567890')
})

it('merges nested contexts, lets call fields win, and keeps concurrent requests apart', () => {
  const out = runScript(`
    const log = logger.forModule('/app/src/routes/data.ts')
    await Promise.all(['req-a', 'req-b'].map((request_id, i) => log.withContext({ request_id }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 20 - i * 10))
      log.withContext({ data_file: 'notes' }, () => log.info('Logged in a nested context.', { request_id: request_id + '-call' }))
      log.info('Logged after an await.')
    })))
    log.info('Logged outside any context.')
  `, { LOG_STDOUT: 'true' })
  const lines = parseLines(out)
  const after = (id: string) => lines.find((line) => line.message === 'Logged after an await.' && line.request_id === id)
  assert.ok(after('req-a') && after('req-b'), 'each request keeps its own id across the await')
  const nested = lines.filter((line) => line.message === 'Logged in a nested context.')
  assert.deepEqual(nested.map((line) => line.request_id).sort(), ['req-a-call', 'req-b-call'])
  assert.ok(nested.every((line) => line.data_file === 'notes'))
  const outside = lines.find((line) => line.message === 'Logged outside any context.')
  assert.equal(outside?.request_id, undefined)
})

it('names modules after the file, a folder index after its folder, and the root logger jsonserver', () => {
  const out = runScript(`
    logger.info('Logged by the root logger.')
    logger.forModule('/app/src/routes/data.ts').info('Logged by a file.')
    logger.forModule('/app/src/config/index.ts').info('Logged by a folder index.')
    logger.forModule('/app/src/index.ts').info('Logged by the entry point.')
    logger.forModule('/app/dist/index.js').info('Logged by the built entry point.')
  `, { LOG_STDOUT: 'true' })
  assert.deepEqual(parseLines(out).map((line) => line.module), ['jsonserver', 'data', 'config', 'index', 'index'])
})

it('numbers a second archive for the same day, and close() can be called twice', () => {
  const dir = logDir()
  const file = path.join(dir, 'application.log')
  const yesterday = localDay(new Date(Date.now() - DAY))
  try {
    fs.writeFileSync(path.join(dir, `application-${yesterday}.log.gz`), zlib.gzipSync('earlier rotation\n'))
    const { status, stderr } = runModule(dir, `
      import { DailyFileTransport } from ${TRANSPORT}
      const transport = new DailyFileTransport({ filename: ${JSON.stringify(file)}, retentionDays: 14 })
      const write = (text) => new Promise((resolve) => transport.log({ [Symbol.for('message')]: text }, resolve))
      await write('yesterday-again')
      transport.day = ${JSON.stringify(yesterday)}
      await write('today')
      transport.close()
      transport.close()
      await transport.whenClosed
    `)
    assert.equal(status, 0, stderr)
    assert.deepEqual(fs.readdirSync(dir).sort(), [`application-${yesterday}-1.log.gz`, `application-${yesterday}.log.gz`, 'application.log'])
    assert.deepEqual(readLines(path.join(dir, `application-${yesterday}-1.log.gz`)), ['yesterday-again'])
    assert.deepEqual(readLines(path.join(dir, `application-${yesterday}.log.gz`)), ['earlier rotation'])
    assert.deepEqual(readLines(file), ['today'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// The standard: messages are complete sentences (capital letter, final period) with no ids or values in them,
// and extra fields are snake_case
it('keeps every log call in src/ to the message and field style', () => {
  const problems: string[] = []
  const files = (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== path.join('logging', 'logger.ts'))
    .map((f) => path.join(SRC, f))
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/logger\.(debug|info|warning|error|critical)\(([^]*?)\)\s*(?:\n|$|\))/g)) {
      const call = match[2] ?? ''
      const where = `${path.relative(SRC, file)}: ${(call.split('\n')[0] ?? '').slice(0, 80)}`
      const message = call.match(/^\s*'([^']*)'/)
      if (!message) {
        problems.push(`${where} - message must be a plain string literal`)
        continue
      }
      if (!/^[A-Z].*\.$/.test(message[1] ?? '')) problems.push(`${where} - message must start with a capital letter and end with a period`)
      for (const key of call.slice(message[0].length).matchAll(/[{,]\s*([A-Za-z_]+)\s*:/g)) {
        if (!/^[a-z][a-z0-9_]*$/.test(key[1] ?? '')) problems.push(`${where} - field ${key[1]} must be snake_case`)
      }
    }
    if (/logger\.(warn|fatal)\(/.test(source)) problems.push(`${path.relative(SRC, file)} - use logger.warning / logger.critical`)
  }
  assert.deepEqual(problems, [])
})
