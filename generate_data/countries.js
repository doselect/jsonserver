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
    return _.get(city, 'name');
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
    _.set(country, 'emoji', emoji)
    return _.sortKeysBy(country);
  })
}


const sanitizeCountries = (countries) => {
  return _.map(countries, (country) => {
    const newCountry = _.omit(country, ["alpha3Code", "altSpellings", "cioc", "demonym", "regionalBlocs", "translations", "gini"]);
    _.set(newCountry, 'languages', _.map(_.get(newCountry, 'languages'), (language) => {
      return _.get(language, 'name');
    }))
    return _.sortKeysBy(newCountry);
  })
}

request('https://restcountries.eu/rest/v2/all', { json: true }, (err, res, body) => {
  if (err) { return console.log(err); }
  const countriesWithId = addCountriesId(body);
  const countriesWithFlag = getCountriesFlag(countriesWithId);
  const countriesWithStates = getCountriesWithStates(countriesWithFlag);
  const countries = { "countries": _.orderBy(sanitizeCountries(getCountriesMoreDetails(countriesWithStates)), ['id']) };
  
  fs.writeFileSync(path.join(__dirname, '../data/countries.json'), beautify(countries, null, 2, 80), 'utf8');
});


