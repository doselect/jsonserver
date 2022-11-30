const inventory = require('../data/inventory.json')
const path = require('path');
const beautify = require("json-beautify");

const fs = require('fs');
const _ = require('lodash');

const newInventory = _.map(_.get(inventory, 'inventory'), (data, index) => {
  _.set(data, 'id', index + 1);
  return data;
});

const inventoryDb = {
  "inventory": newInventory
};

fs.writeFileSync(path.join(__dirname, '../data/inventory.json'), beautify(inventoryDb, null, 2, 80), 'utf8');
