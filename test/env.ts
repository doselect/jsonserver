// Environment for the suites, set before anything from src/ is imported (config is read once, when it loads).
// Imported first by helpers.ts. Logs are muted; the logger has its own suite that runs child processes
process.env.SILENT = 'true'
process.env.LOG_STDOUT = 'true'
delete process.env.LOG_DIRECTORY
