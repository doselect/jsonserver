"use strict";
// const express = require('express');
const serverless = require("serverless-http");
const jsonServer = require("json-server");
const request = require("request");
const middlewares = jsonServer.defaults();
const app = jsonServer.create();

app.use(middlewares);

// Route to be hit by default
app.use("/api/:fileName/:splat1?", (req, res, next) => {
  const { fileName, splat1 } = req.params;
  let redirectRoute, url;

// Checking if splat exists and if yes, adding it to the end of the url   
  if (splat1) {
    url = `/${splat1}${req.url}`;
  } else {
    url = `${req.url}`;
  }

//   Checking if splat is equal to filename and if not adding filename twice to the route with url 
  if (fileName === splat1) {
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

// App to run locally
module.exports = app;

// Handler to run as serverless
module.exports.handler = serverless(app);
