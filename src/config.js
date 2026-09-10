import 'dotenv/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const required = (name) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    )
  }
  return value
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  // Comma-separated list of browser origins allowed to call this API with cookies.
  origins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  databaseFile: process.env.DATABASE_FILE ?? path.join(root, 'data', 'hothobs.db'),

  jwtSecret: required('JWT_SECRET'),
  // How long a login lasts before the customer has to sign in again.
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),

  // Cookies must be Secure + SameSite=None when the API and site are on
  // different domains in production (e.g. api.hothobs... and hothobs...).
  crossSiteCookies: process.env.CROSS_SITE_COOKIES === 'true',

  // Where the customer-facing site lives. Paystack sends people back here
  // after they pay, so it has to be the real public origin in production.
  siteUrl: (process.env.SITE_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),

  // Paystack is the only payment method. The secret key stays on the
  // server — the browser never sees it and never talks to Paystack's API
  // directly, only to the checkout page Paystack hosts.
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    currency: process.env.PAYSTACK_CURRENCY ?? 'NGN',
  },
}

export const isProduction = config.env === 'production'
