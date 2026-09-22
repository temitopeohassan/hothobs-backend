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
  // In production a missing value must not fall back to localhost: Paystack
  // would send paying customers to a page that does not exist.
  siteUrl: (
    process.env.NODE_ENV === 'production'
      ? required('SITE_URL')
      : (process.env.SITE_URL ?? 'http://localhost:5173')
  ).replace(/\/+$/, ''),

  // Paystack is the only payment method. The secret key stays on the
  // server — the browser never sees it and never talks to Paystack's API
  // directly, only to the checkout page Paystack hosts.
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',
    currency: process.env.PAYSTACK_CURRENCY ?? 'NGN',
  },

  // Outgoing email, over SMTP. Only used to tell the kitchen about paid
  // orders; leave SMTP_HOST empty and nothing is sent. See src/lib/mail.js.
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    // Header the kitchen sees the email from. Gmail rewrites it to SMTP_USER.
    from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
    // Where new-order notifications go. Comma separated for more than one.
    orderNotifyTo: (process.env.ORDER_NOTIFY_EMAIL ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean),
  },
}

export const isProduction = config.env === 'production'
