const faker = require('faker');
const _ = require('lodash');
const {Factory} = require('rosie');
const path = require('path');
const fs = require('fs');
const beautify = require("json-beautify");
const employees = [];

Factory.define('employees')
  .sequence('id')
  .attr('firstName', () => { return faker.name.firstName(); })
  .attr('lastName', () => { return faker.name.lastName(); })
  .attr('fullName', ['firstName', 'lastName'], (firstName, lastName) => { return `${firstName} ${lastName}` })
  .attr('bloodGroup', () => {
    const bloodGroups = ['A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-'];
    return _.sample(bloodGroups)
  })
  .attr('dateOfBirth', () => {
    return faker.date.between('1975-01-01', '1985-12-31');
  })
  .attr('companyName', () => {
    return faker.company.companyName();
  })
  .attr('dateOfJoining', () => {
    return faker.date.between('2011-01-01', '2015-12-31');
  })
  .attr('designation', () => {
    const designations = ['Trainee Engineer',
      'Software Engineer',
      'System Analyst',
      'Programmer Analyst',
      'Senior Software Engineer',
      'Project Lead',
      'Project Manager',
      'Program Manager',
      'Architect',
      'Technical Specialist',
      'Deliver Manager',
      'Delivery Head',
      'Business Analyst',
      'Director Technology',
      'Director',
      'Vice President',
      'President',
      'CEO'];
    return _.sample(designations);
  })
  .attr('salary', () => {
    return _.random(8000, 20000);
  })
  .attr('experience', () => {
    return _.random(1, 10);
  })
  .attr('address', () => {
    const address = {
      "streetAddress": `${faker.address.streetAddress()}`,
      "streetName": `${faker.address.streetName()}`,
      "city": `${faker.address.city()}`,
      "state": `${faker.address.state()}`,
      "country": `${faker.address.country()}`,
      "zipcode": `${faker.address.zipCode()}`
    }

    return address;
  })


_.times(500, () => {
  const employee = Factory.build('employees')
  employees.push(employee)
})

fs.writeFileSync(path.join(__dirname, '../data/employees.json'), beautify({"employees": _.orderBy(employees, ['id'])}, null, 2, 80), 'utf8');