// Generates data/leaves.json: 50 fake leave requests starting in the next few days (`npm run generate:leaves`)
import { faker } from '@faker-js/faker'
import { Factory } from 'rosie'
import { writeData } from './write-data.ts'

/** How many leave requests to generate. */
const COUNT = 50

/**
 * A date as the leaves data writes it: `YYYY-M-D`, without zero padding (`2020-3-13`).
 *
 * @param {Date} date - The date.
 * @returns {string} The formatted date.
 */
function unpadded (date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/**
 * A random day between `fromDays` and `toDays` days from today.
 *
 * @param {number} fromDays - Earliest day, counted from today.
 * @param {number} toDays - Latest day, counted from today.
 * @returns {string} The day, formatted by {@link unpadded}.
 */
function dayFromNow (fromDays: number, toDays: number): string {
  const from = new Date()
  from.setDate(from.getDate() + fromDays)
  const to = new Date()
  to.setDate(to.getDate() + toDays)
  return unpadded(faker.date.between({ from: unpadded(from), to: unpadded(to) }))
}

Factory.define('leaves')
  .sequence('id')
  .attr('name', () => faker.person.firstName())
  .attr('startDate', () => dayFromNow(0, 2))
  .attr('endDate', () => dayFromNow(3, 7))

writeData('leaves', Factory.buildList('leaves', COUNT))
