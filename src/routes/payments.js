/**
 * Paystack payment state.
 *
 * Two things can tell us an order was paid, and both come from Paystack
 * rather than from the browser:
 *
 *   POST /api/payments/verify   the customer has just been redirected back
 *                               and we ask Paystack what happened
 *   POST /api/payments/webhook  Paystack tells us directly, signed
 *
 * The webhook is the one that must not be missed — a customer who pays and
 * then closes the tab never hits the callback. Both funnel through the same
 * settle() so the outcome is identical either way, and both are safe to
 * arrive twice.
 */
import { Router } from 'express'
import { db } from '../db.js'
import { route, badRequest, notFound } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { verifyTransaction, verifyWebhookSignature, fromKobo } from '../lib/paystack.js'

const router = Router()

const findByReference = db.prepare('SELECT * FROM orders WHERE reference = ?')
const findForUser = db.prepare('SELECT * FROM orders WHERE reference = ? AND user_id = ?')
const markPaid = db.prepare(
  `UPDATE orders
      SET payment_status = 'paid', payment_channel = ?, payment_amount = ?,
          paid_at = COALESCE(paid_at, datetime('now')), status = 'confirmed'
    WHERE reference = ? AND payment_status <> 'paid'`
)
const markUnpaid = db.prepare(
  `UPDATE orders SET payment_status = ? WHERE reference = ? AND payment_status = 'pending'`
)

/** Paystack's transaction statuses, mapped onto ours. */
const OUTCOME = {
  success: 'paid',
  failed: 'failed',
  abandoned: 'abandoned',
  reversed: 'failed',
}

/**
 * Apply what Paystack says about a transaction to the order it belongs to.
 *
 * Idempotent: a webhook and a verify call racing each other, or Paystack
 * retrying a delivery, all land on the same row and the same result.
 */
function settle(transaction) {
  const reference = String(transaction?.reference ?? '')
  if (!reference) return null

  const order = findByReference.get(reference)
  if (!order) {
    console.warn('Paystack referenced an order we do not have:', reference)
    return null
  }

  const outcome = OUTCOME[transaction.status] ?? 'pending'

  if (outcome === 'paid') {
    const paid = fromKobo(Number(transaction.amount ?? 0))
    // Guard against a transaction that succeeded for the wrong amount —
    // pay it no attention rather than confirming an order we were underpaid for.
    if (paid !== order.total) {
      console.error(
        `Paystack settled ${reference} at ₦${paid} but the order totals ₦${order.total}. Left unpaid for staff to look at.`
      )
      return findByReference.get(reference)
    }
    markPaid.run(String(transaction.channel ?? ''), paid, reference)
  } else if (outcome !== 'pending') {
    markUnpaid.run(outcome, reference)
  }

  return findByReference.get(reference)
}

/**
 * Called by the site when the customer lands back on /order/complete.
 * The reference in the URL only says which order to ask about — the answer
 * comes from Paystack.
 */
router.post(
  '/payments/verify',
  requireAuth,
  route(async (req, res) => {
    const reference = String(req.body?.reference ?? '').trim()
    if (!reference) throw badRequest('That payment reference is missing.')

    const owned = findForUser.get(reference, req.user.id)
    if (!owned) throw notFound('We could not find that order on your account.')

    // Already settled by the webhook — no need to ask again.
    if (owned.payment_status !== 'pending') {
      return res.json({ status: owned.payment_status, reference })
    }

    const transaction = await verifyTransaction(reference)
    const order = settle(transaction) ?? owned
    res.json({ status: order.payment_status, reference })
  })
)

/**
 * Paystack's own notification. Signed with HMAC-SHA512 over the raw body,
 * so server.js mounts express.raw on this path ahead of express.json —
 * once JSON has parsed and re-serialised the body the signature can never
 * match again.
 *
 * Always answers 200: Paystack retries anything else, and a retry cannot
 * fix a payload we have already handled or cannot recognise.
 */
router.post('/payments/webhook', (req, res) => {
  if (!Buffer.isBuffer(req.body)) {
    console.error('The Paystack webhook body was not raw — check the mount order in server.js.')
    return res.status(500).json({ error: 'Webhook misconfigured.' })
  }

  if (!verifyWebhookSignature(req.body, req.get('x-paystack-signature'))) {
    console.warn('Rejected a Paystack webhook with a bad signature.')
    return res.status(401).json({ error: 'Invalid signature.' })
  }

  let event
  try {
    event = JSON.parse(req.body.toString('utf8'))
  } catch {
    return res.status(200).json({ received: true })
  }

  if (String(event?.event ?? '').startsWith('charge.')) {
    try {
      settle(event.data)
    } catch (error) {
      console.error('Failed to settle a Paystack webhook:', error)
    }
  }

  return res.status(200).json({ received: true })
})

export default router
