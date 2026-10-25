// Reading error details safely from anything thrown

/**
 * err.code of any thrown value, if it has one.
 *
 * Safe on anything (`unknown` from catch, null, strings); only a string `code` counts.
 *
 * @param {unknown} err - Caught value.
 * @returns {string | undefined} The string `code` property, or undefined.
 */
export function errorCode (err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return err.code
  return undefined
}

/**
 * HTTP status carried by an error, as set by body-parser and http-errors (`status` or `statusCode`).
 *
 * @param {unknown} err - Error passed to the Express error handler.
 * @returns {number} The error's 4xx/5xx status, else 500.
 */
export function errorStatus (err: unknown): number {
  if (err && typeof err === 'object') {
    const { status, statusCode } = err as { status?: unknown, statusCode?: unknown }
    for (const value of [status, statusCode]) {
      if (typeof value === 'number' && value >= 400 && value < 600) return value
    }
  }
  return 500
}
