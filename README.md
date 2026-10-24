# DoSelect Json Server


## Steps to run locally
1. Clone the repo
2. Install packages (npm install)
3. Run command **npm run dev** to start the dev server
4. To check if the server is working, open your web browser and go to <http://localhost:8888>. You should see the JsonServer welcome page. To check if data is returned as expected go to http://localhost:8888/api/filename where the filename is the name of a file from the **data** folder. e.g. <http://localhost:8888/api/notes> (Preferably use the URL in Postman for get request)

## How data is served
- Files are read from the **data** folder of the deployed code, so changes to data go live only after a redeploy.
- `/api/notes/1` and `/api/notes/notes/1` both return the `notes` resource from `data/notes.json`. The older `/json/notes/notes/1` route still works.
- POST, PUT, PATCH and DELETE return a normal response but are not saved. Every request starts from the original data.
- Set `PORT` to change the local port (default 8888).
- Requires Node.js 24 LTS (24.22.1 or newer 24.x, see .nvmrc).

## Health Check

Get request to `/health` will return `{ "status": "Ok" }` with a `200` status code