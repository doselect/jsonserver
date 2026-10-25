// Timestamps in the DoSelect logging standard

/**
 * Current time for the `asctime` field of a log line.
 *
 * Formatted as "2026-10-23T17:57:07+0000", like Python's %Y-%m-%dT%H:%M:%S%z in UTC (milliseconds dropped).
 *
 * @param {Date} [date] - The moment to format; defaults to now.
 * @returns {string} The UTC time in that format.
 */
export function asctime (date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+0000')
}
