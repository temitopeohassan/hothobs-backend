/**
 * Paystack — the only way this site takes payment.
 *
 * We use the redirect ("Standard") flow: the server initialises a
 * transaction, Paystack returns an authorization_url, the browser goes
 * there, pays, and comes back to our callback. The secret key never
 * leaves this process and no card details ever touch our servers.
 *
 * An order is only ever marked paid from a response we fetched from
 * Paystack ourselves — either a verify call or a signed webhook. What
 * the browser says on its way back from the checkout is a hint about
 * which order to look at, nothing more.
 */
import crypto from 'node:crypto'
import { config } from '../config.js'
import { ApiError } from './errors.js'

const BASE = 'https://api.paystack.co'

/** Paystack works in kobo; the rest of this codebase works in whole naira. */
export const toKobo = (naira) => Math.round(naira * 100)
export const fromKobo = (kobo) => Math.round(kobo / 100)

function requireKey() {
  if (!config.paystack.secretKey) {
    throw new ApiError(
      503,
      'Online payment is not configured yet. Please call the kitchen to place this order.'
    )
  }
  return config.paystack.secretKey
}

async function call(path, { method = 'GET', body } = {}) {
  const key = requireKey()
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch (error) {
    // A network failure here is ours to own, not the customer's to decode.
    console.error('Paystack request failed:', error)
    throw new ApiError(502, 'We could not reach Paystack. Please try again in a moment.')
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok || payload?.status !== true) {
    console.error('Paystack rejected a request:', response.status, payload)
    throw new ApiError(502, payload?.message || 'Paystack could not process that payment.')
  }
  return payload.data
}

/**
 * Start a transaction. `amount` is in naira; `reference` is our own order
 * reference, so a webhook can find the order without a lookup table.
 */
export async function initializeTransaction({ reference, email, amount, callbackUrl, metadata }) {
  return call('/transaction/initialize', {
    method: 'POST',
    body: {
      reference,
      email,
      amount: toKobo(amount),
      currency: config.paystack.currency,
      callback_url: callbackUrl,
      metadata,
    },
  })
}

/** Ask Paystack what actually happened to a transaction. */
export async function verifyTransaction(reference) {
  return call(`/transaction/verify/${encodeURIComponent(reference)}`)
}

/**
 * Paystack signs every webhook with HMAC-SHA512 over the raw body using
 * the secret key. Compare in constant time and reject anything else —
 * this endpoint is the one place an outsider could mark an order paid.
 */
export function verifyWebhookSignature(rawBody, signature) {
  const key = config.paystack.secretKey
  if (!key || !signature || !rawBody) return false
  const expected = crypto.createHmac('sha512', key).update(rawBody).digest('hex')
  const given = Buffer.from(String(signature), 'utf8')
  const mine = Buffer.from(expected, 'utf8')
  if (given.length !== mine.length) return false
  return crypto.timingSafeEqual(given, mine)
}
