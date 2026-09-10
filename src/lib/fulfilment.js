/**
 * Delivery zones live on the server so a customer cannot choose their own
 * delivery fee. The checkout page fetches this list from GET /api/zones.
 *
 * TODO replace with Hothobs' confirmed delivery zones and fees.
 * A null fee means "we quote this one after we call".
 */
export const zones = [
  { id: 'pickup', label: 'Pickup from our kitchen', fee: 0 },
  { id: 'mainland', label: 'Delivery — Mainland', fee: 3000 },
  { id: 'island', label: 'Delivery — Island', fee: 4500 },
  { id: 'outside', label: 'Delivery — outside Lagos', fee: null },
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
