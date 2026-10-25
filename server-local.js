const app = require('./src/app');
const logger = require('./src/logger').forModule(__filename);
const { flushLogs } = require('./src/logger');

const port = process.env.PORT || 8888;

const exitAfterLogging = (code) => {
  flushLogs().finally(() => process.exit(code));
};

process.on('uncaughtException', (err) => {
  logger.critical('Uncaught exception occurred and the process is exiting.', { err });
  exitAfterLogging(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection occurred.', { err: reason });
});

const server = app.listen(port, () => {
  logger.info('Json server started.', { port: Number(port), node_version: process.version });
});

server.on('error', (err) => {
  logger.critical('Failed to start the HTTP server.', { port: Number(port), err });
  exitAfterLogging(1);
});
