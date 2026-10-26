// Logging: Python level names, as in the DoSelect logging standard

/**
 * Log levels from least to most severe, named as in Python logging (written upper-case as `levelname`).
 */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error', 'critical'] as const
/**
 * One of `LOG_LEVELS`.
 */
export type LogLevel = typeof LOG_LEVELS[number]

/**
 * winston priorities (lower is more severe).
 */
export const LEVEL_PRIORITIES: Readonly<Record<LogLevel, number>> = { critical: 0, error: 1, warning: 2, info: 3, debug: 4 }

/**
 * Levels whose error lines carry the stack trace (exc_info).
 */
export const STACK_TRACE_LEVELS: ReadonlySet<string> = new Set(['error', 'critical'])

/**
 * Source root in development (src/) and in the build (dist/): their index file logs as `index`, not the folder name.
 */
export const ROOT_FOLDERS: ReadonlySet<string> = new Set(['src', 'dist'])

/**
 * Name of the live log file in LOG_DIRECTORY, as in the Django/FastAPI services (Filebeat reads only this name).
 * It never carries a date; rotated days become `application-YYYY-MM-DD.log.gz`.
 */
export const LOG_FILE_NAME = 'application.log'

/** How often the file transport checks for a new day, so days without log lines are rotated too (one minute). */
export const LOG_ROTATE_CHECK_MS = 60 * 1000

/** Length of a day in milliseconds, for the archive retention cutoff. */
export const DAY_MS = 24 * 60 * 60 * 1000
