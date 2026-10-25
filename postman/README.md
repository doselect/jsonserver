# Postman Collection

`DoSelect-Json-Server.postman_collection.json` tests every route of the DoSelect JSON Server. It has 69 requests and 98 checks, and it is safe to run against any environment, including production, because write requests are never saved.

For the full test plan and acceptance criteria, see [QA_GUIDE.md](../QA_GUIDE.md).

## What's in it

| Folder | What it covers |
|---|---|
| Root, Health Check | The server is up: `/` and `/health` |
| Reusable write methods | POST, PUT, PATCH and DELETE for the dataset in the `resource` variable |
| Dataset CRUD matrix | Write requests for each of the 9 datasets. Each subfolder sets its own `resource` |
| Query parameter patterns | Filtering, partial match, full-text search, sorting and pagination |
| Dataset APIs | List and get-by-ID for every dataset, plus create, replace, update and delete for notes |

Every request checks that the status is 2xx. Many also check the response body.

## Variables

The collection's variables are set on the collection itself (Collection → Variables tab).

| Variable | Default | Used for |
|---|---|---|
| `baseUrl` | `http://localhost:8888` | Server to test. Change it per environment (see below) |
| `resource` | `notes` | Dataset for the reusable and query requests |
| `recordId` | `1` | ID for get, update and delete requests |
| `queryField` | `title` | Field used in filter requests |
| `queryValue` | `Learn node.js` | Value used in filter and search requests |
| `sortField` | `id` | Field used for sorting |
| `offset` | `0` | Start index for `_start` pagination |
| `pageSize` | `5` | Page size for `_limit` pagination |

If you change `resource`, also change `queryField` and `queryValue` to a field and value that exist in that dataset. Otherwise the filter requests return empty arrays.

## Environments

| Environment | `baseUrl` |
|---|---|
| Local | `http://localhost:8888` |
| Dev | `jsonserver.dev.sg1.chsh.in` |
| Stg2 | `jsonserver.stg2.sg1.chsh.in` |
| Stg3 | `jsonserver.stg3.sg1.chsh.in` |
| Production | `jsonmock.doselect.com` |

Add `https://` (or `http://` if the environment doesn't serve HTTPS) in front of the host.

## Run it in the Postman app

1. Postman → **Import** → select `postman/DoSelect-Json-Server.postman_collection.json`.
2. Open the collection → **Variables** → set `baseUrl` to the environment under test → **Save**.
3. Click **Run** on the collection → **Run DoSelect JSON Server**.
4. All requests should pass with 0 failures.

## Run it from the command line (Newman)

Start the server locally first if you're testing local:

```bash
npm install
npm start            # serves http://localhost:8888
```

In another terminal:

```bash
# Local
npx newman run postman/DoSelect-Json-Server.postman_collection.json

# Another environment
npx newman run postman/DoSelect-Json-Server.postman_collection.json --env-var baseUrl=https://jsonmock.doselect.com

# Stability run: 20 times in a row
npx newman run postman/DoSelect-Json-Server.postman_collection.json -n 20 --env-var baseUrl=<url>
```

A passing run ends with a table showing `0` in the **failed** column for requests and assertions.

## Things to know while testing

- **Writes aren't saved.** POST returns 201 with a new id (for example `51` for notes), but a GET for that id afterwards returns 404. PATCH, PUT and DELETE work the same way. This is intended.
- **Two URL forms work.** `/api/notes/1` and `/api/notes/notes/1` return the same note. The older `/json/notes/notes/1` route still works too.
- **`inventory` and `matches` have no `id` field.** Get-by-ID returns 404 for them, so filter by a field instead, such as `/api/inventory?barcode=74001755`. A POST to them needs an `id` in the body.
- **Pagination headers.** `_page` and `_start` requests return `X-Total-Count`. `_page` requests also return a `Link` header.
- **Error responses** are short JSON messages such as `{"error":"Not found"}`. If you ever see a stack trace or server file path in a response, report it as a bug.
