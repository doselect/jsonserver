# DoSelect Json Server

Serves the JSON files in `data/` as a fake REST API (json-server), for candidates' front-end assignments. Written in
TypeScript in the same style as eden: Node 24 runs the `.ts` sources directly, so there is no build step.

## Steps to run locally
1. Clone the repo
2. Install packages: `npm install`
3. Optionally copy `.env.sample` to `.env` and change settings
4. Run `npm run dev` to start the dev server (restarts on changes, logs indented JSON)
5. To check if the server is working, open <http://localhost:8888>. You should see `{ "status": "Ok" }`. To check
   that data is returned, go to `http://localhost:8888/api/<file>`, where `<file>` is the name of a file in the
   **data** folder, e.g. <http://localhost:8888/api/notes> (preferably in Postman).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with `.env` loaded, restarts on changes |
| `npm start` | Runs `src/index.ts` as on the servers |
| `npm test` | eslint (type-aware) + `tsc` + all vitest suites; run before every PR |
| `npm run build` / `npm run start:dist` | Optional: compile to `dist/` and run the JavaScript |
| `npm run generate:<notes\|employees\|leaves\|countries>` | Regenerate a data file (see `dev/`) |

Requires Node.js 24 LTS (24.22.1 or newer 24.x, see .nvmrc).

## How data is served
- Files are read from the **data** folder of the deployed code, so changes to data go live only after a redeploy.
  Every `<name>.json` there is served as `/api/<name>`, so only put public sample data in it.
- `/api/notes/1` and `/api/notes/notes/1` both return the `notes` resource from `data/notes.json`. The older
  `/json/notes/notes/1` route still works.
- POST, PUT, PATCH and DELETE return a normal response but are not saved. Every request starts from the original data.
- `<field>_like` filters match plain text (they are not regular expressions) and are limited to 100 characters.
  `?callback=` is ignored, so answers are always JSON. Request bodies over 100 KiB get 413.

## Code layout

| Path | What it holds |
|---|---|
| `src/index.ts` | Entry point: config check, HTTP server, graceful shutdown on SIGTERM |
| `src/app.ts` | The Express app (json-server's Express 4) and its middleware order |
| `src/config/index.ts` | Every setting, read from the environment |
| `src/routes/` | `data.ts` (`/api`, `/json`) and `health.ts` (`/`, `/health`) |
| `src/services/data-store.ts` | The data files, loaded once and kept in memory |
| `src/middlewares/` | Request id and access log, request guards |
| `src/logging/` | `logger.ts` (JSON logger) and `daily-file-transport.ts` (the daily rotated `application.log`) |
| `src/constants/`, `src/utils/` | Shared values and helpers |
| `dev/` | Data generators (not deployed code) |
| `test/` | vitest suites |

## Configuration

All settings come from environment variables (see `.env.sample`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8888` | HTTP port |
| `DATA_DIRECTORY` | `data/` in the repo | Folder of the JSON files to serve |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | On SIGTERM, how long in-flight requests may take before the process exits |
| `LOG_LEVEL` | `INFO` | DEBUG, INFO, WARNING, ERROR or CRITICAL |
| `LOG_STDOUT` | `true` | Write logs to stdout |
| `LOG_DIRECTORY` | (none) | Also write logs to `<LOG_DIRECTORY>/application.log`. Every day the previous day's lines move to `application-YYYY-MM-DD.log.gz` |
| `LOG_RETENTION_DAYS` | `14` | Days of log files kept, older ones are deleted |
| `SERVICE_NAME`, `SERVICE_ROLE` | `jsonserver` | `do_service` and `do_role` on every line |
| `LOG_PRETTY` | `false` | Indented JSON for local reading (`npm run dev` sets it) |
| `SILENT` | `false` | Turn all logging off (tests) |

An invalid setting stops the server at boot with a `Configuration is invalid.` CRITICAL line listing every problem.

## Logging
Logs are JSON lines in the DoSelect logging standard, the same format as eden: `levelname, asctime, module, process,
thread, message, do_service, do_role`, then snake_case fields. Every line for a request carries its `request_id`
(taken from `X-Request-Id` or generated, and returned in the `X-Request-Id` header).

INFO lines:
- `Found the data files to serve.` and `Json server started.` at boot, with the port, version, data folder and log settings
- `Loaded the data file into memory.` the first time a file is used, with its resources, record count, size and load time
- `Request completed.` once per request (except `/health`), with method, endpoint, `data_file`, status and response time
- `Received a request for a data file that does not exist.`, and the guard rejections (body too large, `_like` too long)
- `Received shutdown signal and stopped accepting connections.` and `Completed graceful shutdown.` on SIGTERM

On servers the playbook sets `LOG_DIRECTORY=/webapps/jsonserver/logs/` and `LOG_STDOUT=false`, and starts
`node src/index.ts`.

## Testing
- `npm test`: lint, type check and the vitest suites (`npx vitest run test/<file>` for one):
  - `qa-flows.test.ts`: every step of QA_GUIDE.md flows B-G, named by step id
  - `api.test.ts`: routes and the request guards (path tricks, `_like`, JSONP, body size)
  - `data-store.test.ts`: which files are served, caching, broken files, writes kept private
  - `config.test.ts`: defaults and every validation rule
  - `logger.test.ts`: log line format, levels, context, rotation, retention and failure handling
  - `server.test.ts`: `src/index.ts` from start to shutdown, and the CRITICAL exits at boot
  - `utils.test.ts`: the small helpers
- `TARGET_URL=https://jsonserver.stg3.sg1.chsh.in npm run test:remote`: runs `qa-flows.test.ts` and `api.test.ts`
  against a deployed environment instead of a local server. Safe on every environment, as writes are never saved.
  There, the AWS load balancer rejects URLs with `%2F` or `%00` with its own 400 before they reach the app; the tests
  accept that in remote runs only
- [QA_GUIDE.md](QA_GUIDE.md): test flows, expected results and acceptance criteria.
- [postman/README.md](postman/README.md): how to run the Postman collection in the app or with Newman.

## Health Check

`/` and `/health` return `{ "status": "Ok" }` with a `200` status code. The json-server welcome page is turned off in
every environment, including local.
