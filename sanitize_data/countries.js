const request = require('request');
const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const beautify = require("json-beautify");
const imageDownload = require('image-downloader');

// Json-server needs id to fetch single data
const addCountriesId = (dataSet) => {
  return _.map(dataSet, (data, index) => {
    _.set(data, 'id', index+1)
      return data
  })
}

// Downloading countries flag to /assets/flags
const getCountriesFlag = (dataSet) => {
 return _.map(dataSet, (data) => {
   const flagFileName = _.replace(_.get(data, 'flag'), 'https://restcountries.eu/data/', '');
    const newFlagUrl = `https://raw.githubusercontent.com/doselect/jsonserver/master/assets/flags/${flagFileName}`
    imageDownload.image({
      url: _.get(data, 'flag'),
      dest: path.join(__dirname, `../assets/flags/${flagFileName}`)
    }).then(({ filename, image }) => {
      console.log('Saved to', filename)  // Saved to /path/to/dest/image.jpg
    })
      .catch((err) => console.error(err))

   _.set(data, 'flag', newFlagUrl)
   return data
  })
}

request('https://restcountries.eu/rest/v2/all', { json: true }, (err, res, body) => {
  if (err) { return console.log(err); }
  const countriesWithId = addCountriesId(body)

  const countries = getCountriesFlag(countriesWithId)

  fs.writeFileSync(path.join(__dirname, '../data/countries.json'), beautify(countries, null, 2, 80), 'utf8');
});


