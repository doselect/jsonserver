// Generates data/employees.json: 500 fake employees (`npm run generate:employees`). Each run gives different people
import { faker } from '@faker-js/faker'
import { Factory } from 'rosie'
import { writeData } from './write-data.ts'

/** How many employees to generate. */
const COUNT = 500

const BLOOD_GROUPS = ['A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-']
const DESIGNATIONS = [
  'Trainee Engineer', 'Software Engineer', 'System Analyst', 'Programmer Analyst', 'Senior Software Engineer',
  'Project Lead', 'Project Manager', 'Program Manager', 'Architect', 'Technical Specialist', 'Deliver Manager',
  'Delivery Head', 'Business Analyst', 'Director Technology', 'Director', 'Vice President', 'President', 'CEO'
]

Factory.define('employees')
  .sequence('id')
  .attr('firstName', () => faker.person.firstName())
  .attr('lastName', () => faker.person.lastName())
  .attr('fullName', ['firstName', 'lastName'], (firstName: string, lastName: string) => `${firstName} ${lastName}`)
  .attr('bloodGroup', () => faker.helpers.arrayElement(BLOOD_GROUPS))
  .attr('dateOfBirth', () => faker.date.between({ from: '1975-01-01', to: '1985-12-31' }))
  .attr('companyName', () => faker.company.name())
  .attr('dateOfJoining', () => faker.date.between({ from: '2011-01-01', to: '2015-12-31' }))
  .attr('designation', () => faker.helpers.arrayElement(DESIGNATIONS))
  .attr('salary', () => faker.number.int({ min: 8000, max: 20000 }))
  .attr('experience', () => faker.number.int({ min: 1, max: 10 }))
  .attr('address', () => ({
    streetAddress: faker.location.streetAddress(),
    streetName: faker.location.street(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    zipcode: faker.location.zipCode()
  }))

writeData('employees', Factory.buildList('employees', COUNT))
