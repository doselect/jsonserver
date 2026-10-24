"use strict";
const fs = require("fs");
const path = require("path");
const jsonServer = require("json-server");
const middlewares = jsonServer.defaults();
const app = jsonServer.create();

app.disable("x-powered-by");

const DATA_DIR = path.join(__dirname, "../data");
// Only files that exist in the data folder can be served
const DATA_FILES = new Set(
  fs.readdirSync(DATA_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.basename(file, ".json"))
);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const cache = new Map();

// json-server's router sends the error stack trace to the client, so its error
// handler is removed and errors go to the app's error handler below
const createRouter = (data) => {
  const router = jsonServer.router(data);
  router.stack = router.stack.filter((layer) => layer.handle.length !== 4);
  return router;
};

// Parsing the file and building its router once, then reusing them for reads
const loadData = (fileName) => {
  if (!cache.has(fileName)) {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${fileName}.json`), "utf8"));
    cache.set(fileName, { data, router: createRouter(structuredClone(data)) });
  }
  return cache.get(fileName);
};

// Writes run against a fresh copy of the data, so they respond like a real API
// but are never persisted or visible to other requests
const serveData = (fileName, req, res, next) => {
  if (!DATA_FILES.has(fileName)) {
    return res.status(404).send({ error: "Not found" });
  }

  let entry;
  try {
    entry = loadData(fileName);
  } catch (error) {
    console.error(error);
    return res.status(500).send({ error: "Unable to load data" });
  }

  const router = READ_METHODS.has(req.method)
    ? entry.router
    : createRouter(structuredClone(entry.data));
  router(req, res, next);
};

app.use(middlewares);

// Route to be hit by default, /api/notes/1 and /api/notes/notes/1 both work
app.use("/api/:fileName", (req, res, next) => {
  const { fileName } = req.params;
  const [, firstSegment] = req.url.split(/[/?]/);

//   Adding the filename as the resource name if it isn't already in the url
  if (firstSegment !== fileName) {
    req.url = `/${fileName}${req.url}`;
  }
  serveData(fileName, req, res, next);
});

// Kept for clients that call the json route directly
app.use("/json/:fileName", (req, res, next) => {
  serveData(req.params.fileName, req, res, next);
});

// Health Check
app.use("/health", (req, res, next) => {
  return res.status(200).send({ status: "Ok" });
});

// Errors are logged on the server, clients only get a short message without the stack trace
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).send({ error: status < 500 ? "Invalid request" : "Something went wrong" });
});

// App to run as node server
module.exports = app;
