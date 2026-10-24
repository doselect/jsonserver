# JSON Server – QA Guide

This guide covers testing the security upgrade and rework of the DoSelect JSON Server (`jsonmock.doselect.com`). It lists what changed, the test flows, the expected results and the acceptance criteria for sign-off.

For running the Postman collection, see [postman/README.md](postman/README.md).

## 1. What changed

| Area | Before | After | What QA should check |
|---|---|---|---|
| Node.js | Node 20 | Node 24 LTS (24.22.1 or newer 24.x) | The server runs and the deploy check passes |
| Dependencies | 9 known vulnerabilities, including the sabotaged `faker@6.6.6` | `npm audit` reports 0 vulnerabilities | Run `npm audit` |
| Data source | Every request downloaded the file from GitHub | Files are read from the deployed `data/` folder once and kept in memory | Responses are fast. A data change only shows up after a redeploy |
| `/api/...` routing | Answered with a 307 redirect to `/json/...` | Answered directly with 200, no redirect | No 3xx responses |
| Unknown or malicious file names | Could crash the server or read files outside `data/` | Return `404 {"error":"Not found"}` | Negative tests in flow F |
| Error responses | Sent the stack trace and server file paths | Send a short JSON error only. Details go to the server log | Negative tests in flow F |
| `X-Powered-By: Express` header | Sent | Removed | Check response headers |
| Writes (POST/PUT/PATCH/DELETE) | Fake: response looked successful, nothing was saved | Same, unchanged | Flow E |

## 2. Environments

| Environment | Base URL | Deployed from |
|---|---|---|
| Local | `http://localhost:8888` | Your working copy (`npm install && npm start`) |
| Dev | `jsonserver.dev.sg1.chsh.in` | `release` branch |
| Stg2 | `jsonserver.stg2.sg1.chsh.in` | `release` branch |
| Stg3 | `jsonserver.stg3.sg1.chsh.in` | `release` branch |
| Production | `jsonmock.doselect.com` | `master` branch |

Use `https://` for an environment if it serves HTTPS, otherwise `http://`. All tests are safe to run on any environment, including production: no request changes the stored data.

## 3. Reference data

| Dataset | URL | Records | Has `id` (get by ID works) |
|---|---|---|---|
| countries | `/api/countries` | 250 | Yes |
| domestic_flights | `/api/domestic_flights` | 38 | Yes |
| employees | `/api/employees` | 500 | Yes |
| flights | `/api/flights` | 5 | Yes |
| inventory | `/api/inventory` | 500 | No (use `?barcode=...`) |
| leaves | `/api/leaves` | 50 | Yes |
| matches | `/api/matches` | 53 | No |
| notes | `/api/notes` | 50 | Yes |
| universities | `/api/universities` | 100 | Yes |

## 4. Test flows

`{{baseUrl}}` means the base URL of the environment under test. Every response body is JSON unless the step says otherwise.

### Flow A – Smoke test (run after every deploy)

| ID | Steps | Expected result |
|---|---|---|
| A1 | GET `/` | 200, HTML welcome page |
| A2 | GET `/health` | 200, `{"status":"Ok"}` |
| A3 | GET `/api/notes` | 200, array of 50 notes |
| A4 | GET `/api/notes/1` | 200, note with `"title": "Learn node.js"` |
| A5 | Run the full Postman collection (see the Postman README) | 0 failed requests, 0 failed assertions |

### Flow B – Read APIs for every dataset

| ID | Steps | Expected result |
|---|---|---|
| B1 | GET the list URL for each of the 9 datasets in section 3 | 200, JSON array with the record count from section 3 |
| B2 | GET `/api/<dataset>/1` for the 7 datasets that have `id` | 200, one object with `"id": 1` |
| B3 | GET `/api/notes/999` (ID that does not exist) | 404, `{}` |
| B4 | GET `/api/inventory/1` and `/api/matches/1` | 404, `{}` (these datasets have no `id`) |
| B5 | GET `/api/inventory?barcode=74001755` | 200, array with one item whose `barcode` is `74001755` |

### Flow C – URL formats and backward compatibility

| ID | Steps | Expected result |
|---|---|---|
| C1 | GET `/api/notes/2`, `/api/notes/notes/2` and `/json/notes/notes/2` | All three return 200 with the same note (id 2) |
| C2 | GET `/api/notes` with redirects turned off (Postman: Settings → "Automatically follow redirects" off) | 200 directly, **not** 307 |
| C3 | GET `/api/notes?title_like=Buy` | 200, query string is applied: 3 notes, ids 2, 42, 50 |

### Flow D – Filtering, search, sorting and pagination

Run these on `/api/notes`.

| ID | Steps | Expected result |
|---|---|---|
| D1 | `?title=Learn node.js` | 1 note, id 1 |
| D2 | `?id_gte=1&id_lte=5` | Notes 1–5 |
| D3 | `?id_ne=1` | 49 notes, none with id 1 |
| D4 | `?title_like=Learn` | 6 notes: ids 1, 17, 26, 31, 38, 46 |
| D5 | `?id=1&id=2` | Notes 1 and 2 |
| D6 | `?q=passport` | Note 11 ("Renew passport") |
| D7 | `?_sort=id&_order=desc` | First item has id 50 |
| D8 | `?_page=2&_limit=5` | Notes 6–10. Headers: `X-Total-Count: 50` and a `Link` header with first/prev/next/last |
| D9 | `?_start=0&_limit=5` | Notes 1–5, header `X-Total-Count: 50` |
| D10 | `?title_like=Learn&_sort=id&_order=desc&_limit=2` | 2 notes: ids 46, 38 (in that order) |

### Flow E – Write requests (responses only, nothing is saved)

Writes return realistic responses, but every request starts from the original data. This is intended behaviour: it lets candidates practise write calls without changing the data for anyone else.

| ID | Steps | Expected result |
|---|---|---|
| E1 | POST `/api/notes` with body `{"title":"QA note","description":"test"}` | 201, body contains the note with `"id": 51` |
| E2 | Then GET `/api/notes/51` | 404 (the new note was not saved) |
| E3 | PATCH `/api/notes/1` with `{"title":"Changed"}` | 200, body shows `"title": "Changed"` |
| E4 | Then GET `/api/notes/1` | 200, title is still `"Learn node.js"` |
| E5 | PUT `/api/notes/1` with `{"title":"Replaced","description":"x"}` | 200, body is the replaced note |
| E6 | DELETE `/api/notes/1`, then GET `/api/notes/1` | DELETE 200, GET still 200 (not deleted) |
| E7 | PUT or PATCH `/api/notes/999` | 404 |
| E8 | POST `/api/matches` with body `{"id":"qa-1","team1":"A"}` | 201 |

### Flow F – Errors and security (negative tests)

For every test in this flow, the response must **not** contain a stack trace, the words `Error:` or `at `, or a server file path such as `/webapps/` or `node_modules`.

| ID | Steps | Expected result |
|---|---|---|
| F1 | GET `/api/doesnotexist` | 404, `{"error":"Not found"}` |
| F2 | GET `/api/..%2F..%2Fpackage` | 404, `{"error":"Not found"}` |
| F3 | GET `/json/..%2F..%2Fpackage.json/x` | 404, `{"error":"Not found"}` |
| F4 | GET `/api/health_check` (a non-JSON file name) | 404, `{"error":"Not found"}` |
| F5 | POST `/api/notes` with header `Content-Type: application/json` and the broken body `{bad` | 400, `{"error":"Invalid request"}` |
| F6 | POST `/api/inventory` or `/api/matches` with a body that has **no** `id` | 500, `{"error":"Something went wrong"}` (known limitation, see section 6) |
| F7 | Check the response headers of any request | No `X-Powered-By` header |
| F8 | After F1–F7, GET `/health` and `/api/notes/1` | Both 200: the server is still running |

### Flow G – CORS (browser clients)

| ID | Steps | Expected result |
|---|---|---|
| G1 | GET `/api/notes/1` with header `Origin: https://example.com` | 200, header `Access-Control-Allow-Origin: https://example.com` |
| G2 | OPTIONS `/api/notes` with headers `Origin: https://example.com` and `Access-Control-Request-Method: POST` | 204 |

### Flow H – Performance and stability

| ID | Steps | Expected result |
|---|---|---|
| H1 | GET `/api/countries` (largest dataset) three times | The first call may be slower. Later calls are fast (under 100 ms locally; on servers, mostly network time) |
| H2 | Run the collection 20 times in a row: `npx newman run postman/DoSelect-Json-Server.postman_collection.json -n 20 --env-var baseUrl=<url>` | 0 failures, no 5xx responses, no timeouts |
| H3 | During H2, check `/health` | Always 200 |

### Flow I – Deployment checks (with DevOps)

| ID | Steps | Expected result |
|---|---|---|
| I1 | On the instance: `node -v` | `v24.22.1` or a newer `v24.x` |
| I2 | On the instance: `sudo supervisorctl status jsonserver` | `RUNNING` |
| I3 | In the repo: `npm audit` | `found 0 vulnerabilities` |
| I4 | Deploy log | The "Ensure Node.js is 24 LTS" task passes |

## 5. Acceptance criteria

The task can be signed off when all of these are true on the target environment:

- [ ] All Flow A smoke tests pass.
- [ ] The Postman collection runs with 0 failed requests and 0 failed assertions.
- [ ] All 9 datasets return the record counts in section 3.
- [ ] `/api/<name>`, `/api/<name>/<name>` and `/json/<name>/<name>` return the same data, with no 3xx redirect.
- [ ] Filtering, search, sorting and pagination behave as described in Flow D.
- [ ] Write requests return the expected status codes and never change the data seen by later requests (Flow E).
- [ ] Unknown datasets and path traversal attempts return 404 (Flow F).
- [ ] No response ever contains a stack trace, server file path or `X-Powered-By` header.
- [ ] Invalid requests never stop the server: `/health` stays 200 after all negative tests.
- [ ] Repeated runs (Flow H) show no 5xx responses or timeouts.
- [ ] The instance runs Node 24.22.1 or newer 24.x, and `npm audit` reports 0 vulnerabilities.

## 6. Known limitations (not bugs)

- **Writes are not saved.** This is intended (Flow E).
- **POST without an `id` to `inventory` or `matches` returns a 500.** These datasets have no `id` field, so the server can't generate one. Include an `id` in the body to get a 201.
- **Data changes need a redeploy.** Editing a file in `data/` has no effect on a running server until it is redeployed and restarted.

## 7. Reporting a bug

Include:
- The environment and full URL, the HTTP method, request headers and request body.
- The expected and actual status code and response body. Attach the Postman or Newman output if you have it.
- The test case ID from this guide, such as `F5`.
- The time of the request, so DevOps can find it in the server logs.
