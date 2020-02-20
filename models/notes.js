const fs  = require('fs')

module.exports = JSON.parse(fs.readFileSync('./data/notes.json', 'utf8'));
