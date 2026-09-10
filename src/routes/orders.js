import { Router } from 'express'
import crypto from 'node:crypto'
import { db } from '../db.js'
import { Check, str } from '../lib/validate.js'
import { route, badRequest, notFound } from '../lib/errors.js'
import { requireAuth } from '../middleware/auth.js'
import { zones, findZone, paymentMethods, PAYMENT_METHOD } from '../lib/fulfilment.js'
import { priceLine } from '../lib/catalogue.js'
import { initializeTransaction } from '../lib/paystack.js'
import { config } from '../config.js'

const router = Router()

const insertOrder = db.prepare(
  `INSERT INTO orders (
     reference, user_id, customer_name, customer_phone, customer_email,
     fulfilment, zone_id, zone_label, address, wanted_for, notes,
     payment_method, subtotal, delivery_fee, total,
     status, payment_status, payment_reference
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'pending', ?)`
)
const insertItem = db.prepare(
  `INSERT INTO order_items (
     order_id, slug, name, portion_label, option_labels, notes, tone, unit_price, qty
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
)
const listOrders = db.prepare(
  'SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
)
const countOrders = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id = ?')
const findOrder = db.prepare('SELECT * FROM orders WHERE reference = ? AND user_id = ?')
const findOrderById = db.prepare('SELECT * FROM orders WHERE id = ?')
const listItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
const referenceTaken = db.prepare('SELECT 1 FROM orders WHERE reference = ?')
// Only ever used on an order we have just created and failed to make payable.
const deleteUnpaidOrder = db.prepare(
  "DELETE FROM orders WHERE id = ? AND payment_status = 'pending' AND paid_at IS NULL"
)

// No I, O, 0 or 1 — references get read out over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newReference() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let code = ''
    for (const byte of crypto.randomBytes(5)) code += ALPHABET[byte % ALPHABET.length]
    const reference = `HH-${code}`
    if (!referenceTaken.get(reference)) return reference
  }
  throw new Error('Could not allocate an order reference')
}

const shape = (order, items) => ({
  reference: order.reference,
  placedAt: order.created_at,
  status: order.status,
  customer: {
    name: order.customer_name,
    phone: order.customer_phone || null,
    email: order.customer_email || null,
  },
  fulfilment: order.fulfilment,
  zone: { id: order.zone_id, label: order.zone_label },
  address: order.address || null,
  wantedFor: order.wanted_for || null,
  notes: order.notes || null,
  paymentMethod: order.payment_method,
  payment: {
    status: order.payment_status,
    reference: order.payment_reference || null,
    channel: order.payment_channel || null,
    paidAt: order.paid_at || null,
  },
  subtotal: order.subtotal,
  deliveryFee: order.delivery_fee,
  total: order.total,
  items: items.map((i) => ({
    slug: i.slug,
    name: i.name,
    portionLabel: i.portion_label || null,
    optionLabels: JSON.parse(i.option_labels),
    notes: i.notes || null,
    tone: i.tone,
    unitPrice: i.unit_price,
    qty: i.qty,
  })),
})

const withItems = (order) => shape(order, listItems.all(order.id))

/**
 * What the checkout page is allowed to offer: the zones with the fees the
 * server will actually apply, and the payment methods — of which there is
 * exactly one.
 */
router.get('/zones', (_req, res) => res.json({ zones, paymentMethods }))

/**
 * Place an order and start its payment.
 *
 * Requires an account — checkout has no guest path — so every order is
 * attached to a customer and appears in their order history.
 *
 * The order is written as payment_status 'pending' and the response
 * carries a Paystack authorization URL. It is not a confirmed order until
 * Paystack tells us the money arrived; nothing here marks it paid.
 */
router.post(
  '/orders',
  requireAuth,
  route(async (req, res) => {
    const body = req.body ?? {}
    const check = new Check()

    check.text('name', body.name, { label: 'Full name', min: 2, max: 120 })
    // Optional at checkout — the account's email is how we reach them otherwise.
    if (str(body.phone)) check.phone('phone', body.phone)

    const zone = findZone(str(body.zone))
    if (!zone) check.add('zone', 'Choose how you would like to receive this order.')

    const isPickup = zone?.id === 'pickup'
    if (zone && !isPickup) {
      check.text('address', body.address, { label: 'Delivery address', min: 6, max: 500 })
    }
    if (str(body.wantedFor).length > 200) check.add('wantedFor', 'Keep this under 200 characters.')
    if (str(body.notes).length > 1000) check.add('notes', 'Keep your notes under 1000 characters.')

    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) check.add('items', 'Your cart is empty.')
    else if (rawItems.length > 60) check.add('items', 'That is too many separate items for one order.')
    check.done()

    // Price every line here, from ids. The browser sends what was chosen,
    // never what it costs — see src/lib/catalogue.js.
    const items = rawItems.map((item, index) => {
      const qty = Number(item?.qty)
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        throw badRequest(`Item ${index + 1} has an invalid quantity.`)
      }
      const { line, error } = priceLine({
        slug: str(item?.slug),
        portionId: str(item?.portionId) || null,
        options:
          item?.options && typeof item.options === 'object' && !Array.isArray(item.options)
            ? item.options
            : {},
        qty,
      })
      if (error) throw badRequest(`One of your items ${error}. Please remove it and try again.`)
      return { ...line, notes: str(item?.notes).slice(0, 500) }
    })

    const subtotal = items.reduce((n, i) => n + i.unitPrice * i.qty, 0)
    const deliveryFee = zone.fee
    const total = subtotal + (deliveryFee ?? 0)

    // A zone we quote by hand has no price yet, so there is nothing to
    // charge — Paystack cannot take an open-ended amount.
    if (deliveryFee === null) {
      throw badRequest(
        'We quote delivery outside Lagos by hand, so this one cannot be paid for online yet. ' +
          'Please call the kitchen and we will arrange it with you.'
      )
    }
    if (total < 100) {
      throw badRequest('This order is below the smallest amount Paystack can charge.')
    }

    db.exec('BEGIN')
    let order
    try {
      const reference = newReference()
      const { lastInsertRowid } = insertOrder.run(
        reference,
        req.user.id,
        str(body.name),
        str(body.phone),
        req.user.email,
        isPickup ? 'pickup' : 'delivery',
        zone.id,
        zone.label,
        isPickup ? '' : str(body.address),
        str(body.wantedFor),
        str(body.notes),
        PAYMENT_METHOD,
        subtotal,
        deliveryFee,
        total,
        // Our order reference doubles as the Paystack reference, so a
        // webhook can find the order without a lookup table.
        reference
      )
      const orderId = Number(lastInsertRowid)
      for (const item of items) {
        insertItem.run(
          orderId,
          item.slug,
          item.name,
          item.portionLabel,
          JSON.stringify(item.optionLabels),
          item.notes,
          item.tone,
          item.unitPrice,
          item.qty
        )
      }
      db.exec('COMMIT')
      order = findOrderById.get(orderId)
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    // An order Paystack never gave us a link for can never be paid, so it is
    // not an order — drop it rather than leaving a row nobody can settle and
    // staff have to wonder about. The customer sees the real error and can
    // try again.
    let transaction
    try {
      transaction = await initializeTransaction({
        reference: order.reference,
        email: order.customer_email,
        amount: order.total,
        callbackUrl: `${config.siteUrl}/order/complete`,
        metadata: {
          order_reference: order.reference,
          customer_name: order.customer_name,
          fulfilment: order.fulfilment,
          zone: order.zone_label,
        },
      })
    } catch (error) {
      try {
        deleteUnpaidOrder.run(order.id)
      } catch (cleanup) {
        console.error(`Could not clean up unpayable order ${order.reference}:`, cleanup)
      }
      throw error
    }

    res.status(201).json({
      order: withItems(order),
      payment: {
        authorizationUrl: transaction.authorization_url,
        reference: order.reference,
      },
    })
  })
)

/** Order history for the signed-in customer. */
router.get(
  '/orders',
  requireAuth,
  route(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
    const page = Math.max(Number(req.query.page) || 1, 1)
    const { n: total } = countOrders.get(req.user.id)

    res.json({
      orders: listOrders.all(req.user.id, limit, (page - 1) * limit).map(withItems),
      page,
      limit,
      total,
      hasMore: page * limit < total,
    })
  })
)

router.get(
  '/orders/:reference',
  requireAuth,
  route(async (req, res) => {
    const order = findOrder.get(req.params.reference, req.user.id)
    if (!order) throw notFound('We could not find that order on your account.')
    res.json({ order: withItems(order) })
  })
)

export default router
