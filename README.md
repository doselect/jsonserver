# DoSelect Json Server


## Steps to run locally
1. Clone the repo
2. Install packages (npm install)
3. Run command **npm run dev** to start the dev server
4. To check if the server is working, open your web browser and go to <http://localhost:8888>. You should see `{ "status": "Ok" }`. To check if data is returned as expected go to http://localhost:8888/api/filename where the filename is the name of a file from the **data** folder. e.g. <http://localhost:8888/api/notes> (Preferably use the URL in Postman for get request)

## How data is served
- Files are read from the **data** folder of the deployed code, so changes to data go live only after a redeploy.
- `/api/notes/1` and `/api/notes/notes/1` both return the `notes` resource from `data/notes.json`. The older `/json/notes/notes/1` route still works.
- POST, PUT, PATCH and DELETE return a normal response but are not saved. Every request starts from the original data.
- Set `PORT` to change the local port (default 8888).
- Requires Node.js 24 LTS (24.22.1 or newer 24.x, see .nvmrc).

## Logging
Logs are JSON lines in the DoSelect logging standard, the same format as eden: `levelname, asctime, module, process, thread, message, do_service, do_role`, then snake_case fields. Every request gets one `Request completed.` line (except `/health`), and every line for a request carries its `request_id` (taken from `X-Request-Id` or generated, and returned in the `X-Request-Id` header).

| Variable | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `INFO` | DEBUG, INFO, WARNING, ERROR or CRITICAL |
| `LOG_STDOUT` | `true` | Write logs to stdout |
| `LOG_DIRECTORY` | (none) | Also write logs to `<LOG_DIRECTORY>/application.log`. Every day the previous day's lines move to `application-YYYY-MM-DD.log.gz` |
| `LOG_RETENTION_DAYS` | `14` | Days of log files kept, older ones are deleted |
| `SERVICE_NAME`, `SERVICE_ROLE` | `jsonserver` | `do_service` and `do_role` on every line |
| `LOG_PRETTY` | `false` | Indented JSON for local reading |
| `SILENT` | `false` | Turn all logging off |

On servers the playbook sets `LOG_DIRECTORY=/webapps/jsonserver/logs/` and `LOG_STDOUT=false`.

## Testing
- [QA_GUIDE.md](QA_GUIDE.md): test flows, expected results and acceptance criteria.
- [postman/README.md](postman/README.md): how to run the Postman collection in the app or with Newman.

## Health Check

`/` also returns `{ "status": "Ok" }`. The json-server welcome page is turned off in every environment, including local.


Get request to `/health` will return `{ "status": "Ok" }` with a `200` status code