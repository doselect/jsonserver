const jsonServer = require('json-server');

const app = jsonServer.create()


const disabledMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];

app.use(jsonServer.bodyParser);

app.use((req, res, next) => {
  const method = req.method;
  if (disabledMethods.indexOf(method) !== -1) {
    return res.sendStatus(400);
  }
  next()
});

app.use(jsonServer.defaults({
  logger: process.env.NODE_ENV !== 'production'
}))


app.use((req, res, next) => {
  const router = jsonServer.router('db.json');
  router(req, res, next);
})

module.exports = app
