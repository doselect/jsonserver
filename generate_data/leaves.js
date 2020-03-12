const path = require('path');
const faker = require('faker');
const _ = require('lodash');
const fs = require('fs');
const beautify = require("json-beautify");
const { Factory } = require('rosie');
const leaves = [];

Factory.define('leaves')
    .sequence('id')
    .attr('name', () => { return faker.name.firstName(); })
    .attr('startDate', () => {
        const start = new Date();
        const end = new Date();
        end.setDate(start.getDate() + 2);
        const date = faker.date.between(
            start.getFullYear() + '-' + (start.getMonth() + 1) + '-' + start.getDate(),
            end.getFullYear() + '-' + (end.getMonth() + 1) + '-' + end.getDate());
        return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
    })
    .attr('endDate', () => {
        const start = new Date();
        start.setDate(start.getDate() + 3);
        const end = new Date();
        end.setDate(start.getDate() + 4);
        const date = faker.date.between(
            start.getFullYear() + '-' + (start.getMonth() + 1) + '-' + start.getDate(),
            end.getFullYear() + '-' + (end.getMonth() + 1) + '-' + end.getDate());
        return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
    });

_.times(50, () => {
    const leave = Factory.build('leaves');
    leaves.push(leave);
});

fs.writeFileSync(path.join(__dirname, '../data/leaves.json'), beautify({ leaves }, null, 2, 80), 'utf8');
