const request = require('request');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const beautify = require("json-beautify");
const imageDownload = require('image-downloader');
const countrycitystate = require('countrycitystatejson');

_.mixin({
    'sortKeysBy': function (obj, comparator) {
        var keys = _.sortBy(_.keys(obj), function (key) {
            return comparator ? comparator(obj[key], key) : key;
        });
    
        return _.zipObject(keys, _.map(keys, function (key) {
            return obj[key];
        }));
    }
});

// Json-server needs id to fetch single data
const addCountriesId = (countries) => {
  return _.map(countries, (country, index) => {
    _.set(country, 'id', index+1)
      return country
  })
}

// Downloading countries flag to /assets/flags
const getCountriesFlag = (countries) => {
 return _.map(countries, (country) => {
   const flagFileName = _.replace(_.get(country, 'flag'), 'https://restcountries.eu/data/', '');
    const newFlagUrl = `https://raw.githubusercontent.com/doselect/jsonserver/master/assets/flags/${flagFileName}`
    imageDownload.image({
      url: _.get(country, 'flag'),
      dest: path.join(__dirname, `../assets/flags/${flagFileName}`)
    }).then(({ filename, image }) => {
      console.log('Saved to', filename)  // Saved to /path/to/dest/image.jpg
    })
      .catch((err) => console.error(err))

   _.set(country, 'flag', newFlagUrl)
   return country
  })
}

const sanitizeCities = (cities) => {
  return _.map(cities, (city) => {
    const state_id = _.get(city, 'state_id')
    const city_id = _.get(city, 'id')
    _.set(city, 'id', _.parseInt(city_id))
    _.set(city, 'state_id', _.parseInt(state_id))
    return city;
  })
}

const sanitizeStates = (states) => {
  return _.map(states, (cities, stateName, index) => {
    const state = {}
    _.set(state, 'name', stateName);
    _.set(state, 'cities', _.isEmpty(cities) ? [] : sanitizeCities(cities))
    return state
  })
}

const getCountriesWithStates = (countries) => {
  return _.forEach(countries, (country) => {
    const shortName = _.get(country, 'alpha2Code');
    const states = _.get(countrycitystate.getCountryByShort(shortName), 'states')
    return _.set(country, 'states', sanitizeStates(states))
  })
}

const getCountriesMoreDetails = (countries) => {
  return _.map(countries, (country) => {
    const shortName = _.get(country, 'alpha2Code');
    const emoji = _.get(countrycitystate.getCountryByShort(shortName), 'emoji')
    const phone = _.get(countrycitystate.getCountryByShort(shortName), 'phone')
    _.set(country, 'emoji', emoji)
    _.set(country, 'phone', phone)
    return _.sortKeysBy(country);
  })
}

request('https://restcountries.eu/rest/v2/all', { json: true }, (err, res, body) => {
  if (err) { return console.log(err); }
  const countriesWithId = addCountriesId(body);
  const countriesWithFlag = getCountriesFlag(countriesWithId);
  const countriesWithStates = getCountriesWithStates(countriesWithFlag);
  const countries = getCountriesMoreDetails(countriesWithStates);
  fs.writeFileSync(path.join(__dirname, '../data/countries.json'), beautify(_.orderBy(countries, ['id']), null, 2, 80), 'utf8');
});


