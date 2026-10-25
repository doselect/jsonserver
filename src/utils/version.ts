// The running jsonserver version, from package.json
import { readFileSync } from 'node:fs'

// package.json sits two levels up from both src/utils and dist/utils
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

/**
 * Version from package.json, e.g. `3.0.0`.
 *
 * Read once, synchronously, when the module loads. Logged when the server starts.
 */
export const version = pkg.version
