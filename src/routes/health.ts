// / and /health: answer { "status": "Ok" } for the load balancer and QA. The root replaces json-server's welcome
// page, which showed its version and external links
import express, { type Router } from 'express'
import { HEALTH_PATH, ROOT_PATH, STATUS_OK_BODY } from '../constants/http.ts'

/**
 * Builds the router for the root and the health check.
 *
 * `GET /` and any method on `/health` answer 200 `{ "status": "Ok" }`. `/health` is not access logged
 * (`QUIET_PATHS`).
 *
 * @returns {Router} Express router to mount at the application root.
 */
export default function health (): Router {
  const router = express.Router()

  router.get(ROOT_PATH, function (_req, res) {
    res.status(200).send(STATUS_OK_BODY)
  })

  router.use(HEALTH_PATH, function (_req, res) {
    res.status(200).send(STATUS_OK_BODY)
  })

  return router
}
