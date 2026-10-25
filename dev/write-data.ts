// Shared by the data generators: writes a data file in the shape the server serves, { "<name>": [...] }
import fs from 'node:fs'
import beautify from 'json-beautify'

/** The repository's data folder. */
export const DATA_DIR = new URL('../data/', import.meta.url)

/**
 * Writes `data/<name>.json` as `{ "<name>": records }`, formatted like the existing files (2 spaces, short values
 * kept on one line up to 80 characters).
 *
 * The top-level key must equal the file name: `/api/<name>` serves the resource of the same name.
 *
 * @param {string} name - File and resource name, e.g. `employees`.
 * @param {unknown[]} records - The records, each with an `id` so get-by-id works.
 * @returns {void}
 */
export function writeData (name: string, records: unknown[]): void {
  fs.writeFileSync(new URL(`${name}.json`, DATA_DIR), beautify({ [name]: records }, null, 2, 80), 'utf8')
  console.log(`Wrote ${records.length} records to data/${name}.json`)
}
