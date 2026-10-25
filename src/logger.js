"use strict";
// JSON logger following the DoSelect logging standard, the same line format as eden's src/logger.ts:
// one flat JSON object per line, starting with
//   levelname, asctime, module, process, thread, message, do_service, do_role
// followed by snake_case context fields. `message` is a complete sentence without ids or values, those go in fields.
// Pass an error as `{ err }` and it becomes error, error_type, error_code, exc_type, exc_value
// (plus exc_info with the stack trace at ERROR and CRITICAL).
//
// Each module takes its own logger:  const logger = require("./logger").forModule(__filename)
// Request context (request_id) is kept in AsyncLocalStorage and added to every line logged while handling it.
//
// Output goes to stdout (LOG_STDOUT, default true) and/or <LOG_DIRECTORY>/application.log. The file name never has a
// date: each day the previous day's lines move to application-YYYY-MM-DD.log.gz, kept LOG_RETENTION_DAYS days
const path = require("path");
const { threadId } = require("worker_threads");
const { AsyncLocalStorage } = require("async_hooks");
const winston = require("winston");
const DailyFileTransport = require("./daily-file-transport");

// Python logging levels, so call sites read logger.warning(...) / logger.critical(...)
const LEVEL_PRIORITIES = { critical: 0, error: 1, warning: 2, info: 3, debug: 4 };
const STACK_TRACE_LEVELS = new Set(["error", "critical"]);

const env = (name, fallback) => (process.env[name] || "").trim() || fallback;

const config = {
  level: env("LOG_LEVEL", "info").toLowerCase().replace(/^warn$/, "warning"),
  stdout: env("LOG_STDOUT", "true") === "true",
  directory: env("LOG_DIRECTORY"),
  retentionDays: env("LOG_RETENTION_DAYS", "14"),
  silent: env("SILENT", "false") === "true",
  pretty: env("LOG_PRETTY", "false") === "true",
  serviceName: env("SERVICE_NAME", "jsonserver"),
  serviceRole: env("SERVICE_ROLE", "jsonserver"),
};

if (!(config.level in LEVEL_PRIORITIES)) {
  throw new Error(`LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL, got ${process.env.LOG_LEVEL}`);
}

// Context fields of the request being handled, added to every line logged within it
const context = new AsyncLocalStorage();

// Formatted as "2026-10-23T17:57:07+0000", like Python's %Y-%m-%dT%H:%M:%S%z in UTC
const asctime = () => new Date().toISOString().replace(/\.\d{3}Z$/, "+0000");

const errorFields = (err, level) => {
  if (!(err instanceof Error)) {
    return { error: typeof err === "object" && err !== null && "message" in err ? String(err.message) : String(err) };
  }
  const fields = {
    error: err.message,
    error_type: (err.constructor && err.constructor.name) || err.name,
    error_code: err.code ?? (err.cause && err.cause.code),
    exc_type: err.name,
    exc_value: err.message,
  };
  if (STACK_TRACE_LEVELS.has(level)) fields.exc_info = err.stack;
  return fields;
};

const standardJson = winston.format.printf((info) => {
  const { level, message, module: moduleName, ...fields } = { ...context.getStore(), ...info };
  // The error goes in `err`; `error: <Error>` is accepted too
  let err = fields.err;
  delete fields.err;
  if (err === undefined && fields.error instanceof Error) {
    err = fields.error;
    delete fields.error;
  }
  const line = {
    levelname: level.toUpperCase(),
    asctime: asctime(),
    module: moduleName || "jsonserver",
    process: process.pid,
    thread: threadId,
    message,
    do_service: config.serviceName,
    do_role: config.serviceRole,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) line[key] = value instanceof Error ? value.message : value;
  }
  if (err !== undefined) {
    for (const [key, value] of Object.entries(errorFields(err, level))) {
      if (value !== undefined) line[key] = value;
    }
  }
  return JSON.stringify(line, null, config.pretty ? 2 : undefined);
});

const transports = [];
if (config.directory) {
  transports.push(new DailyFileTransport({
    filename: path.join(config.directory, "application.log"),
    retentionDays: Number(config.retentionDays),
  }));
}
if (config.stdout) transports.push(new winston.transports.Console());

const base = winston.createLogger({
  levels: LEVEL_PRIORITIES,
  level: config.level,
  format: standardJson,
  transports,
  silent: config.silent || transports.length === 0,
});

// File name without .js; an index file logs as its folder name
const moduleName = (filename) => {
  const file = path.basename(filename).replace(/\.js$/, "");
  return file === "index" ? path.basename(path.dirname(filename)) : file;
};

const wrap = (target) => {
  const write = (level) => (message, fields) => target.log(level, message, fields);
  return {
    debug: write("debug"),
    info: write("info"),
    warning: write("warning"),
    error: write("error"),
    critical: write("critical"),
    forModule: (filename) => wrap(target.child({ module: moduleName(filename) })),
    withContext: (fields, fn) => context.run({ ...context.getStore(), ...fields }, fn),
  };
};

// Flushes and closes every transport, call once before process.exit
const flushLogs = () => new Promise((resolve) => {
  base.on("finish", resolve);
  base.end();
});

module.exports = wrap(base);
module.exports.flushLogs = flushLogs;
