"use strict";
const express = require('express');
const serverless = require("serverless-http");
const jsonServer = require("json-server");
const request = require("request");
const middlewares = jsonServer.defaults();
const app = jsonServer.create();
const actuator = require('express-actuator')

app.use(middlewares);
app.use(actuator())

// Route to be hit by default
app.use("/api/:fileName/:splat?", (req, res, next) => {
  const { fileName, splat } = req.params;
  let redirectRoute, url;

// Checking if splat exists and if yes, adding it to the end of the url   
  if (splat) {
    url = `/${splat}${req.url}`;
  } else {
    url = `${req.url}`;
  }

//   Checking if splat is equal to filename and if not adding filename twice to the route with url 
  if (fileName === splat) {
    redirectRoute = `/json/${fileName}${url}`;
  } else {
    redirectRoute = `/json/${fileName}/${fileName}${url}`;
  }

//   Redirecting to the json route to fetch the data.
  res.redirect(307,redirectRoute);
});


// Code to return data from jsonServer
app.use("/json/:fileName/", (req, res, next) => {
  const { fileName } = req.params;
  const opts = {
    url: `https://raw.githubusercontent.com/doselect/jsonserver/master/data/${fileName}.json`,
    json: true,
  };
  request(opts, function (error, response, body) {
    if (error) {
      return res.status(400).send({ error });
    }
    const jsonrouter = jsonServer.router(body);
    jsonrouter(req, res, next);
  });
});

// App to run as node server
module.exports = app;

// Handler to run as serverless
module.exports.handler = serverless(app);
