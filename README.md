# DoSelect Json Server


## Steps to run locally
1. Clone the repo
2. Install packages (npm install)
3. Run command **npm run dev** to start the dev server
4. To check if the server is working, open your web browser and go to <http://localhost:8888>. You should see the JsonServer welcome page. To check if data is returned as expected go to http://localhost:8888/api/filename where the filename is the name of a file from the **data** folder. e.g. <http://localhost:8888/api/notes> (Preferably use the URL in Postman for get request)

## Health Check

Get request to `/health` will return `{ "status": "Ok" }` with a `200` status code