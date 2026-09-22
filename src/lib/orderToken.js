/**
 * Claim tokens for orders placed without an account.
 *
 * A guest has no session, so after Paystack sends them back there is nothing
 * to prove the order on screen is theirs. Placing the order hands the browser
 * a signed token naming that one reference; the confirmation page sends it
 * back and we let the bearer see — and only see — that order.
 *
 * It is a bearer token for a single reference and nothing else: it cannot
 * list orders, cannot touch an order that belongs to an account, and expires
 * on its own. Signed rather than stored so it needs no table of its own, and
 * a hand-typed reference still gets nowhere.
 */
import jwt from 'jsonwebtoken'
import { config } from '../config.js'

export const ORDER_TOKEN_HEADER = 'x-order-token'

// Long enough to cover a payment that settles slowly and the customer coming
// back to look, short enough that a token left in a shared browser goes stale.
const TTL_DAYS = 3

export const issueOrderToken = (reference) =>
  jwt.sign({ ref: reference, use: 'order' }, config.jwtSecret, { expiresIn: `${TTL_DAYS}d` })

/** The one reference this request carries a valid token for, or null. */
export function orderTokenReference(req) {
  const raw = req.get(ORDER_TOKEN_HEADER) ?? ''
  if (!raw) return null
  try {
    const payload = jwt.verify(raw, config.jwtSecret)
    // Session cookies are signed with the same secret, so check the purpose:
    // a session must never work as an order token, or the other way round.
    if (payload?.use !== 'order' || typeof payload.ref !== 'string') return null
    return payload.ref
  } catch {
    return null
  }
}

/**
 * Whether this request may see this order.
 *
 * An order on an account belongs to that account. A guest order belongs to
 * whoever holds its token — including a customer who has since signed in.
 */
export function mayViewOrder(req, order) {
  if (!order) return false
  if (order.user_id !== null) return req.user?.id === order.user_id
  return orderTokenReference(req) === order.reference
}
