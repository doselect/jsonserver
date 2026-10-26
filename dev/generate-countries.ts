// Regenerates data/countries.json and assets/flags/ from the REST Countries API plus countrycitystatejson
// (`npm run generate:countries`). Each country gets an `id`, its flag URL pointing at this repository's copy, its
// states with their cities, an emoji and a phone code, with keys sorted.
//
// The API it was written for (restcountries.eu, v2) has been shut down: point COUNTRIES_URL at a compatible v2 API
// before running it. data/countries.json is committed, so the server never needs this script
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import imageDownload from 'image-downloader'
import countrycitystate from 'countrycitystatejson'
import { writeData } from './write-data.ts'

/** REST Countries v2 `all` endpoint: an array of countries with `alpha2Code` and `flag`. */
const COUNTRIES_URL = 'https://restcountries.eu/rest/v2/all'
/** Where the flag SVGs are saved, and the public URL the data points at instead of the API's. */
const FLAGS_DIR = fileURLToPath(new URL('../assets/flags/', import.meta.url))
const FLAGS_URL = 'https://raw.githubusercontent.com/doselect/jsonserver/master/assets/flags/'

/** A country as the API returns it; only the fields this script reads are typed. */
interface ApiCountry {
  alpha2Code: string
  flag: string
  [key: string]: unknown
}

/** A city in the output: its ids as numbers. */
interface City {
  id: number
  state_id: number
  [key: string]: unknown
}

/**
 * Downloads a country's flag into assets/flags/ in the background, logging the outcome.
 *
 * @param {string} url - The API's flag URL.
 * @param {string} fileName - File name to save as; already reduced to a base name.
 * @returns {void}
 */
function downloadFlag (url: string, fileName: string): void {
  imageDownload.image({ url, dest: path.join(FLAGS_DIR, fileName) })
    .then(({ filename }) => console.log('Saved to', filename))
    .catch((err: unknown) => console.error(err))
}

/**
 * The country's states as `{ name, cities }`, with numeric city ids.
 *
 * @param {string} alpha2Code - ISO 3166-1 alpha-2 code.
 * @returns {Array<{ name: string, cities: City[] }>} The states; empty when countrycitystatejson has none.
 */
function statesOf (alpha2Code: string): Array<{ name: string, cities: City[] }> {
  const states = countrycitystate.getCountryByShort(alpha2Code)?.states ?? {}
  return Object.entries(states).map(([name, cities]) => ({
    name,
    cities: cities.map((city) => ({ ...city, id: parseInt(city.id, 10), state_id: parseInt(city.state_id, 10) }))
  }))
}

/**
 * The object with its keys in alphabetical order, as the existing data has them.
 *
 * @param {Record<string, unknown>} value - The object.
 * @returns {Record<string, unknown>} A copy with sorted keys.
 */
function sortKeys (value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

const response = await fetch(COUNTRIES_URL)
const countries = await response.json() as ApiCountry[]

const result = countries.map((country, index) => {
  // basename keeps a hostile flag URL from writing outside assets/flags
  const flagFileName = path.basename(country.flag.replace('https://restcountries.eu/data/', ''))
  downloadFlag(country.flag, flagFileName)
  const details = countrycitystate.getCountryByShort(country.alpha2Code)
  return sortKeys({
    ...country,
    id: index + 1,
    flag: `${FLAGS_URL}${flagFileName}`,
    states: statesOf(country.alpha2Code),
    emoji: details?.emoji,
    phone: details?.phone
  })
})

writeData('countries', result)
