// Process exit

/**
 * On a fatal error or after shutdown: the most we wait for logs to flush before exiting, in milliseconds.
 *
 * Bounds the exit so a stuck transport can never keep a crashed process alive.
 */
export const EXIT_FLUSH_TIMEOUT_MS = 3000
