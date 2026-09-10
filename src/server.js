import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { config, isProduction } from './config.js'
import { ApiError } from './lib/errors.js'
import authRoutes from './routes/auth.js'
import orderRoutes from './routes/orders.js'
import paymentRoutes from './routes/payments.js'

const app = express()

// Behind a proxy (Render, Fly, nginx) this makes req.ip and Secure cookies work.
if (isProduction) app.set('trust proxy', 1)

app.disable('x-powered-by')

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and server-to-server calls arrive without an Origin header.
      if (!origin || config.origins.includes(origin)) return callback(null, true)
      callback(new ApiError(403, 'Origin not allowed.'))
    },
    credentials: true,
  })
)
// Paystack signs its webhook over the exact bytes it sent, so that one path
// must keep its raw body. This has to sit ahead of express.json: once JSON has
// parsed and re-serialised the payload the signature can never match again.
app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '256kb' }))

app.use(express.json({ limit: '256kb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env }))

app.use('/api/auth', authRoutes)
app.use('/api', orderRoutes)
app.use('/api', paymentRoutes)

app.use((_req, _res, next) => next(new ApiError(404, 'That endpoint does not exist.')))

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((error, _req, res, _next) => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
    })
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'That request body was not valid JSON.' })
  }
  console.error(error)
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' })
})

app.listen(config.port, () => {
  console.log(`Hothobs API listening on http://localhost:${config.port}`)
  console.log(`Allowing browser origins: ${config.origins.join(', ')}`)
})
