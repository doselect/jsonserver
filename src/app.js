"use strict";
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { performance } = require("perf_hooks");
const jsonServer = require("json-server");
const logger = require("./logger").forModule(__filename);
// json-server's static middleware serves its "Congrats" welcome page at /, which
// exposes the json-server version and external links, so it is left out everywhere.
// Its morgan logger is turned off too, requests are logged as JSON by the middleware below
const middlewares = jsonServer.defaults({ logger: false }).filter((middleware) => middleware.name !== "serveStatic");
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

// Full request path without the query string; req.path loses the mount prefix inside app.use routes
const endpoint = (req) => new URL(req.originalUrl, "http://localhost").pathname;

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
  } catch (err) {
    logger.error("Failed to load the data file.", { file_name: fileName, err });
    return res.status(500).send({ error: "Unable to load data" });
  }

  const router = READ_METHODS.has(req.method)
    ? entry.router
    : createRouter(structuredClone(entry.data));
  router(req, res, next);
};

const MAX_BODY_BYTES = 100 * 1024;
const MAX_LIKE_LENGTH = 100;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Request id (from X-Request-Id or generated) on every line logged for the request, and one access log line per request
app.use((req, res, next) => {
  const header = req.headers["x-request-id"];
  const requestId = typeof header === "string" ? header : randomUUID();
  res.setHeader("X-Request-Id", requestId);
  const started = performance.now();

  logger.withContext({ request_id: requestId }, () => {
    res.on("finish", () => {
      if (endpoint(req) === "/health") return;
      logger.info("Request completed.", {
        method: req.method,
        endpoint: endpoint(req),
        status_code: res.statusCode,
        response_time_ms: Math.round((performance.now() - started) * 100) / 100,
        remote_addr: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
        origin: req.headers.origin,
        referer: req.headers.referer,
        user_agent: req.headers["user-agent"],
      });
    });
    next();
  });
});

app.use(middlewares);

// json-server's body parser accepts up to 10mb and every write clones the data,
// so large bodies are rejected before they reach the router
app.use((req, res, next) => {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
    return res.status(413).send({ error: "Request body too large" });
  }
  next();
});

app.use((req, res, next) => {
  // json-server builds a RegExp from *_like values, so a crafted pattern can block
  // the event loop. Values are escaped and matched as plain text instead
  for (const [key, value] of Object.entries(req.query)) {
    if (!key.endsWith("_like")) continue;
    if (typeof value !== "string" || value.length > MAX_LIKE_LENGTH) {
      return res.status(400).send({ error: "Invalid request" });
    }
    req.query[key] = escapeRegExp(value);
  }
  // json-server responds with res.jsonp, so the callback param is dropped to always return JSON
  delete req.query.callback;
  next();
});

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

// Root returns JSON instead of the json-server welcome page
app.get("/", (req, res) => {
  return res.status(200).send({ status: "Ok" });
});

// Health Check
app.use("/health", (req, res, next) => {
  return res.status(200).send({ status: "Ok" });
});

// Unknown paths get JSON instead of Express's default HTML 404 page
app.use((req, res) => {
  res.status(404).send({ error: "Not found" });
});

// Errors are logged on the server, clients only get a short message without the stack trace
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status < 500) {
    logger.warning("Rejected an invalid request.", { endpoint: endpoint(req), status_code: status, err });
  } else {
    logger.error("Unexpected error while processing request.", { endpoint: endpoint(req), status_code: status, err });
  }
  res.status(status).send({ error: status < 500 ? "Invalid request" : "Something went wrong" });
});

// App to run as node server
module.exports = app;
