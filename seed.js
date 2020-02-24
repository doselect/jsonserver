const path = require('path');
const fs = require('fs');
const beautify = require("json-beautify");
const _ = require('lodash');

const db = {}

_.set(db, 'countries', require('./data/countries.json'))
_.set(db, 'notes', require('./data/notes.json'))
_.set(db, 'employees', require('./data/employees.json'))

fs.writeFileSync(path.join(__dirname, './data/db.json'), beautify(db, null, 2, 80), 'utf8');