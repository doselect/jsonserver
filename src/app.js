const jsonServer = require('json-server');

const app = jsonServer.create()
const router = jsonServer.router('db.json')
const middlewares = jsonServer.defaults({
  logger: process.env.NODE_ENV !== 'production',
  readOnly: true
})

app.use(middlewares)

app.use(jsonServer.rewriter({
  '/api/*': '/$1',
  'api/:resource/:id/show': '/:resource/:id'
}))

app.use(router)

module.exports = app
