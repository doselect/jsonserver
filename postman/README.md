# Postman Collections

| Collection | Requests | Use it for |
|---|---|---|
| `DoSelect-Json-Server-GET.postman_collection.json` | 52 GET, 118 checks | **QA of the read APIs.** Only GET requests, one per QA_GUIDE.md step (flows A-D, the GET checks of F, and G1), each checking the expected result from the guide |
| `DoSelect-Json-Server.postman_collection.json` | 69, 98 checks | Every route, including POST, PUT, PATCH and DELETE |

Both are safe to run against any environment, including production: the GET collection sends no writes, and write requests in the other one are never saved.

For the full test plan and acceptance criteria, see [QA_GUIDE.md](../QA_GUIDE.md).

## GET-only collection

| Folder | What it covers |
|---|---|
| A - Smoke test | `/`, `/health`, the notes list and note 1 |
| B1 - List every dataset | All 9 datasets, each with its record count from the guide |
| B2-B5 - Get by id | Id 1 for the 7 datasets with ids, 404 `{}` for a missing id and for `inventory` and `matches`, inventory by barcode |
| C - URL formats | `/api/notes/2`, `/api/notes/notes/2`, `/json/notes/notes/2`, no redirect, query string applied |
| D - Filtering, search, sorting and pagination | D1-D10 on `/api/notes`, including the `X-Total-Count` and `Link` headers |
| F - Errors and security (GET) | Unknown files and path tricks answer 404, no stack traces or server paths, `_like` is plain text, `?callback=` is ignored, no `X-Powered-By`, the server is still up afterwards |
| G - CORS | The `Origin` header is echoed |

Only `baseUrl` is needed (Collection → Variables). On the deployed environments the AWS load balancer answers its own 400 to URLs with `%2F` or `%00` before they reach the server; the F2 and F3 checks accept that as well as the server's 404.

```bash
npx newman run postman/DoSelect-Json-Server-GET.postman_collection.json --env-var baseUrl=https://jsonserver.stg3.sg1.chsh.in
```

The rest of this README describes the full collection; the import and Newman steps are the same for both.

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
