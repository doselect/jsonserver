'use strict';
const serverless = require('serverless-http');
const jsonServer = require('json-server');
const request = require('request');
const middlewares = jsonServer.defaults();
const app = jsonServer.create();

app.use(middlewares);
app.use('/:fileName', (req, res, next) => {
   const { fileName } = req.params;
   const opts = { url: `https://raw.githubusercontent.com/doselect/jsonserver/master/data/${fileName}.json`, json: true }
   request(opts, function (error, response, body) {
      if (error) {
         return res.status(400).send({ error });
      }
      const jsonrouter = jsonServer.router(body);
      jsonrouter(req, res, next);
   });
});
const handler = serverless(app);
module.exports = app;
// module.exports.handler = serverless(app);
module.exports.handler = async (event, context, callback) => {

  /** Immediate response for WarmUP plugin */
  if (event.source === 'serverless-plugin-warmup') {
    console.log('WarmUP - Lambda is warm!')
    return callback(null, 'Lambda is warm!')
  }

  const result = await handler(event, context);
  // and here
  return result;
};
