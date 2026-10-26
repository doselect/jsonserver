// HTTP API: paths, limits, request guards, server timeouts

/**
 * Data files are served under `/api/<file>` (the default) and `/json/<file>` (kept for older clients).
 *
 * `/api/notes/1` and `/api/notes/notes/1` both reach the `notes` resource of `data/notes.json`.
 */
export const API_PREFIX = '/api'
/**
 * The older route; the URL must name the resource itself (`/json/notes/notes/1`).
 */
export const JSON_PREFIX = '/json'

/**
 * Health check for the load balancer and QA; answers `{ "status": "Ok" }`.
 */
export const HEALTH_PATH = '/health'
/**
 * The root answers the same body as the health check, instead of json-server's welcome page.
 */
export const ROOT_PATH = '/'

/**
 * Probes that get no access log line: these paths and anything under them (`/health/`), as the health route
 * answers all of them.
 *
 * Polled every few seconds by the load balancer; they would drown the request log.
 */
export const QUIET_PATHS: readonly string[] = [HEALTH_PATH]

/**
 * Body of `/` and `/health`.
 */
export const STATUS_OK_BODY = { status: 'Ok' } as const
/**
 * Body of every 404: unknown path or a file that is not in the data folder.
 */
export const NOT_FOUND_BODY = { error: 'Not found' } as const

/**
 * Methods answered from the shared, cached router. Any other method runs against a fresh copy of the data, so
 * writes respond like a real API but are never saved or seen by other requests.
 */
export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Largest request body, in bytes (100 KiB).
 *
 * json-server's own body parser accepts 10 MB and every write clones the whole data file, so larger bodies are
 * answered 413 before they reach it.
 */
export const MAX_BODY_BYTES = 100 * 1024

/**
 * Longest `<field>_like` query value, in characters.
 *
 * json-server turns `_like` values into a RegExp; they are escaped (matched as plain text) and capped, so a crafted
 * pattern cannot block the event loop.
 */
export const MAX_LIKE_LENGTH = 100
/**
 * Query parameters json-server matches as a regular expression.
 */
export const LIKE_SUFFIX = '_like'
/**
 * Query parameter that makes json-server answer JSONP (`res.jsonp`); it is dropped so every answer is plain JSON.
 */
export const JSONP_CALLBACK_PARAM = 'callback'

/**
 * HTTP keep-alive timeout, in milliseconds (65 s).
 *
 * Longer than the load balancer's idle timeout (60s on ALB), so it never reuses a connection we just closed.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65000
/**
 * Time allowed to receive a request's headers, in milliseconds (66 s).
 *
 * Must be greater than `KEEP_ALIVE_TIMEOUT_MS`, or Node may drop a reused keep-alive connection early.
 */
export const HEADERS_TIMEOUT_MS = 66000
