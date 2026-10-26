// Types for the untyped packages the data generators use

declare module 'json-beautify' {
  /**
   * JSON.stringify that keeps short arrays and objects on one line.
   *
   * @param value - Value to serialize.
   * @param replacer - As in JSON.stringify; null for none.
   * @param space - Indent width.
   * @param limit - Line width under which a container is kept on one line.
   * @returns The formatted JSON.
   */
  export default function beautify (value: unknown, replacer: null, space: number, limit: number): string
}

declare module 'countrycitystatejson' {
  /** A country as countrycitystatejson stores it; `states` maps a state name to its cities. */
  interface CountryDetails {
    emoji?: string
    phone?: string
    states?: Record<string, Array<{ id: string, state_id: string, [key: string]: unknown }>>
  }
  const countrycitystate: {
    /**
     * Looks a country up by its ISO 3166-1 alpha-2 code.
     *
     * @param code - e.g. `IN`.
     * @returns The country, or undefined when the code is unknown.
     */
    getCountryByShort (code: string): CountryDetails | undefined
  }
  export default countrycitystate
}
