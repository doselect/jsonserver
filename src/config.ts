// All configuration comes from the environment (see .env.sample). No other module reads process.env.
// Locally, `npm run dev` loads `.env` through node's --env-file-if-exists.
// `validate()` runs at boot and fails fast on anything invalid, instead of failing on the first request
//
// Values are read once, when this module loads: tests set the environment before importing src/.
import { fileURLToPath } from 'node:url'
import { LOG_LEVELS, type LogLevel } from './constants/logging.ts'

/** The process environment; read only in this module. */
const env = process.env

/**
 * Reads an optional environment variable, trimmed.
 *
 * Unset and blank (whitespace-only) values count as missing.
 *
 * @param {string} name - Environment variable name.
 * @returns {string | undefined} The trimmed value, or undefined when missing.
 */
function optional (name: string): string | undefined
/**
 * Reads an environment variable, trimmed, with a default.
 *
 * Unset and blank (whitespace-only) values count as missing and give `fallback`.
 *
 * @param {string} name - Environment variable name.
 * @param {string} fallback - Value when the variable is missing.
 * @returns {string} The trimmed value, else `fallback`.
 */
function optional (name: string, fallback: string): string
/**
 * Implementation of both `optional` overloads.
 *
 * Unset and blank (whitespace-only) values count as missing and give `fallback`.
 *
 * @param {string} name - Environment variable name.
 * @param {string} [fallback] - Value when the variable is missing; without it, missing gives undefined.
 * @returns {string | undefined} The trimmed value, else `fallback`.
 */
function optional (name: string, fallback?: string): string | undefined {
  const value = env[name]
  return value === undefined || value.trim() === '' ? fallback : value.trim()
}

/**
 * Reads an integer environment variable in base 10.
 *
 * Not validated here: a non-numeric value gives NaN, which validate() reports for the numeric settings.
 *
 * @param {string} name - Environment variable name.
 * @param {number} fallback - Value when the variable is unset or blank.
 * @returns {number} The parsed integer (NaN when unparsable; trailing garbage after digits is ignored).
 */
function int (name: string, fallback: number): number {
  return parseInt(optional(name, String(fallback)), 10)
}

/**
 * Thrown by config.validate() when the environment is invalid.
 *
 * index.ts catches it at boot, logs `problems` at CRITICAL as `validation_errors` and exits with code 1.
 */
export class ConfigError extends Error {
  /** One human-readable line per problem, e.g. "PORT must be a non-negative integer". */
  readonly problems: string[]

  /**
   * Creates the error; its message lists every problem on its own indented line.
   *
   * @param {string[]} problems - Every configuration problem found.
   */
  constructor (problems: string[]) {
    super(`Invalid configuration:\n  ${problems.join('\n  ')}`)
    this.problems = problems
    this.name = 'ConfigError'
  }
}

/**
 * Validated, typed configuration read from the environment when this module loads.
 *
 * Settings are plain values; call validate() once at boot (index.ts does) before relying on them.
 * Durations are milliseconds.
 */
const config = {
  /** PORT (default 8888): port for the HTTP API. */
  port: int('PORT', 8888),
  /**
   * DATA_DIRECTORY (default: the repository's `data/` folder): where the JSON files are served from.
   *
   * Every `<name>.json` in it is served as `/api/<name>`; tests point it at fixtures.
   */
  dataDirectory: optional('DATA_DIRECTORY', fileURLToPath(new URL('../data', import.meta.url))),

  /**
   * Logger settings, the same as eden's logger.
   *
   * Containers should log to stdout; LOG_DIRECTORY adds application.log, rotated daily.
   */
  logging: {
    /**
     * LOG_LEVEL (default 'info'): DEBUG | INFO | WARNING | ERROR | CRITICAL (any case); checked in validate().
     *
     * Lowercased, and `warn` is accepted as `warning`.
     */
    level: optional('LOG_LEVEL', 'info').toLowerCase().replace(/^warn$/, 'warning') as LogLevel,
    /** LOG_STDOUT (default 'true'): log to stdout unless set to anything other than 'true'. */
    stdout: optional('LOG_STDOUT', 'true') === 'true',
    /**
     * LOG_DIRECTORY (no default): directory for `application.log` (the name never has a date) and its daily
     * `application-YYYY-MM-DD.log.gz` archives; leave empty in containers.
     */
    directory: optional('LOG_DIRECTORY'),
    /** LOG_RETENTION_DAYS (default 14): delete log archives older than this many days; checked in validate(). */
    retentionDays: int('LOG_RETENTION_DAYS', 14),
    /** SILENT (default 'false'): 'true' mutes every transport (tests). */
    silent: optional('SILENT', 'false') === 'true',
    /** LOG_PRETTY (default 'false'): indented JSON instead of one object per line (local development). */
    pretty: optional('LOG_PRETTY', 'false') === 'true',
    /** SERVICE_NAME (default 'jsonserver'): `do_service` on every line. */
    serviceName: optional('SERVICE_NAME', 'jsonserver'),
    /** SERVICE_ROLE (default 'jsonserver'): `do_role` on every line. */
    serviceRole: optional('SERVICE_ROLE', 'jsonserver')
  },

  /**
   * SHUTDOWN_TIMEOUT_MS (default 10000): graceful shutdown limit, in ms.
   *
   * How long SIGTERM waits for in-flight requests before exiting (with code 1).
   */
  shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000),

  /**
   * Lists every configuration problem; empty when the configuration is valid.
   *
   * Checks: PORT is 1-65535, SHUTDOWN_TIMEOUT_MS and LOG_RETENTION_DAYS are positive integers, a valid LOG_LEVEL,
   * and logs going somewhere. Pure: it reads the values only. logger.ts calls it when it loads, so that with a bad
   * logging setting it logs to stdout only (and the CRITICAL line explaining the exit is still written) instead of
   * acting on the bad value. The data directory is checked when the app reads it (services/data-store.ts).
   *
   * @returns {string[]} One human-readable line per problem.
   */
  problems (): string[] {
    const problems: string[] = []
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('PORT must be an integer from 1 to 65535')
    if (!Number.isInteger(config.shutdownTimeoutMs) || config.shutdownTimeoutMs < 1) problems.push('SHUTDOWN_TIMEOUT_MS must be a positive integer')
    if (!Number.isInteger(config.logging.retentionDays) || config.logging.retentionDays < 1) {
      problems.push('LOG_RETENTION_DAYS must be a positive integer')
    }
    if (!LOG_LEVELS.includes(config.logging.level)) problems.push('LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL')
    if (!config.logging.stdout && !config.logging.directory && !config.logging.silent) problems.push('Logs go nowhere: set LOG_STDOUT=true or LOG_DIRECTORY')
    return problems
  },

  /**
   * Checks the whole configuration and throws ConfigError listing every problem (see problems()).
   *
   * Runs at boot, before anything starts; index.ts logs the problems at CRITICAL and exits 1.
   *
   * @returns {void} Nothing when the configuration is valid.
   * @throws {ConfigError} When anything is invalid; `problems` lists every issue found.
   */
  validate (): void {
    const problems = config.problems()
    if (problems.length) throw new ConfigError(problems)
  }
}

/** Type of the `config` object, for modules and tests that accept a config. */
export type Config = typeof config

export default config
