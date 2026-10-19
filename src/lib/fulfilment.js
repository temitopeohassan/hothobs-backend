/**
 * How an order reaches the customer. The checkout page fetches this list
 * from GET /api/zones.
 *
 * There are no fees here on purpose: delivery is paid by the customer on
 * delivery, so it is never part of what Paystack charges. The
 * zone is kept so the kitchen knows where the order is going.
 */
export const zones = [
  { id: 'pickup', label: 'Pickup from our kitchen' },
  { id: 'mainland', label: 'Delivery — Mainland' },
  { id: 'island', label: 'Delivery — Island' },
  { id: 'outside', label: 'Delivery — outside Lagos' },
]

export const findZone = (id) => zones.find((z) => z.id === id)

/**
 * Paystack is the only way to pay. There is deliberately no bank-transfer
 * or cash-on-delivery path: an order is placed by paying for it, so the
 * kitchen never starts cooking against a promise.
 */
export const PAYMENT_METHOD = 'paystack'

export const paymentMethods = [
  { id: PAYMENT_METHOD, label: 'Card, bank transfer or USSD via Paystack' },
]

export const isPaymentMethod = (id) => id === PAYMENT_METHOD
