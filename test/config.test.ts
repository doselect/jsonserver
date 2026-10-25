// src/config/index.ts: defaults, parsing and every validation rule. Config is read once, when the module loads, so
// each case imports it in a child process with its own environment
import { it } from 'vitest'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Repository root: the child process's working directory. */
const ROOT = path.join(import.meta.dirname, '..')
/** Absolute path of the config module as a JS string literal, for the child's import. */
const CONFIG = JSON.stringify(path.join(ROOT, 'src', 'config', 'index.ts'))

/** What the child reports: the parsed settings and the validation problems. */
interface Loaded {
  config: {
    port: number
    dataDirectory: string
    shutdownTimeoutMs: number
    logging: { level: string, stdout: boolean, directory?: string, retentionDays: number, silent: boolean, pretty: boolean, serviceName: string, serviceRole: string }
  }
  problems: string[]
}

/**
 * Loads the config in a child process with exactly `env` (plus PATH).
 *
 * @param {Record<string, string>} env - Environment for the child.
 * @returns {Loaded} The settings and config.problems().
 */
function load (env: Record<string, string> = {}): Loaded {
  const script = `const { default: config } = await import(${CONFIG}); console.log(JSON.stringify({ config, problems: config.problems() }))`
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' })
  return JSON.parse(out) as Loaded
}

it('has working defaults and no problems with an empty environment', () => {
  const { config, problems } = load()
  assert.deepEqual(problems, [])
  assert.equal(config.port, 8888)
  assert.equal(config.dataDirectory, path.join(ROOT, 'data'))
  assert.equal(config.shutdownTimeoutMs, 10000)
  assert.deepEqual(config.logging, {
    level: 'info',
    stdout: true,
    retentionDays: 14,
    silent: false,
    pretty: false,
    serviceName: 'jsonserver',
    serviceRole: 'jsonserver'
  })
})

it('reads every setting, trimmed', () => {
  const { config, problems } = load({
    PORT: ' 9000 ',
    DATA_DIRECTORY: '/srv/data',
    SHUTDOWN_TIMEOUT_MS: '5000',
    LOG_LEVEL: 'DEBUG',
    LOG_STDOUT: 'false',
    LOG_DIRECTORY: '/var/log/jsonserver',
    LOG_RETENTION_DAYS: '30',
    LOG_PRETTY: 'true',
    SERVICE_NAME: 'json-a',
    SERVICE_ROLE: 'json-b'
  })
  assert.deepEqual(problems, [])
  assert.equal(config.port, 9000)
  assert.equal(config.dataDirectory, '/srv/data')
  assert.equal(config.shutdownTimeoutMs, 5000)
  assert.equal(config.logging.level, 'debug')
  assert.equal(config.logging.stdout, false)
  assert.equal(config.logging.directory, '/var/log/jsonserver')
  assert.equal(config.logging.retentionDays, 30)
  assert.equal(config.logging.pretty, true)
  assert.equal(config.logging.serviceName, 'json-a')
  assert.equal(config.logging.serviceRole, 'json-b')
})

it('treats blank values as unset and accepts WARN for WARNING', () => {
  const { config, problems } = load({ PORT: '   ', LOG_DIRECTORY: '', SERVICE_NAME: ' ', LOG_LEVEL: 'Warn' })
  assert.deepEqual(problems, [])
  assert.equal(config.port, 8888)
  assert.equal(config.logging.directory, undefined)
  assert.equal(config.logging.serviceName, 'jsonserver')
  assert.equal(config.logging.level, 'warning')
})

it('rejects ports outside 1-65535 and non-numeric ones', () => {
  for (const port of ['0', '65536', '-1', 'abc']) {
    assert.deepEqual(load({ PORT: port }).problems, ['PORT must be an integer from 1 to 65535'], port)
  }
  assert.deepEqual(load({ PORT: '65535' }).problems, [])
})

it('rejects a zero or invalid shutdown timeout and retention', () => {
  assert.deepEqual(load({ SHUTDOWN_TIMEOUT_MS: '0' }).problems, ['SHUTDOWN_TIMEOUT_MS must be a positive integer'])
  for (const days of ['0', '-3', 'abc']) {
    assert.deepEqual(load({ LOG_RETENTION_DAYS: days }).problems, ['LOG_RETENTION_DAYS must be a positive integer'], days)
  }
})

it('rejects an unknown log level', () => {
  assert.deepEqual(load({ LOG_LEVEL: 'verbose' }).problems, ['LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL'])
})

it('rejects logs going nowhere, unless logging is silenced', () => {
  assert.deepEqual(load({ LOG_STDOUT: 'false' }).problems, ['Logs go nowhere: set LOG_STDOUT=true or LOG_DIRECTORY'])
  assert.deepEqual(load({ LOG_STDOUT: 'false', SILENT: 'true' }).problems, [])
  assert.deepEqual(load({ LOG_STDOUT: 'false', LOG_DIRECTORY: '/tmp/x' }).problems, [])
})

it('lists every problem at once', () => {
  assert.equal(load({ PORT: '0', SHUTDOWN_TIMEOUT_MS: '0', LOG_RETENTION_DAYS: '0', LOG_LEVEL: 'x', LOG_STDOUT: 'false' }).problems.length, 5)
})
