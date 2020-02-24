'use strict';
const express = require('express');
const serverless = require('serverless-http');
// const jsonServer = require('json-server');
const request = require('request');
// const middlewares = jsonServer.defaults();
const app = express();

// app.use(middlewares);
app.get('/.netlify/functions/json', (req, res, next) => {
   // const { fileName } = req.params;
   const opts = { url: `https://raw.githubusercontent.com/doselect/jsonserver/master/data/db.json`, json: true }
   request(opts, function (error, response, body) {
      if (error) {
         return res.status(400).send({ error });
      }
      res.status(200).send(body);
      // const jsonrouter = jsonServer.router(body);
      // jsonrouter(req, res, next);
   });
});

module.exports = app;
module.exports.handler = serverless(app);