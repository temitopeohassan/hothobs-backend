/**
 * Outgoing email.
 *
 * One job for now: tell the kitchen about an order the moment Paystack
 * confirms it was paid, so someone can start on it. Sent over plain SMTP
 * through nodemailer, so any provider works — a Gmail app password is the
 * simplest for a single inbox.
 *
 * Email is a notification, never part of the transaction: an order is paid
 * whether or not this message gets out. Nothing in here throws to a caller;
 * a failure is logged with the order reference so it can be chased by hand.
 */
import nodemailer from 'nodemailer'
import { config } from '../config.js'

const { mail } = config

export const mailEnabled = Boolean(mail.host && mail.orderNotifyTo.length > 0)

let transporter = null
function transport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: mail.host,
      port: mail.port,
      // 465 is implicit TLS; anything else (587) upgrades with STARTTLS.
      secure: mail.port === 465,
      auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined,
      connectionTimeout: 10000,
      socketTimeout: 20000,
    })
  }
  return transporter
}

if (!mailEnabled) {
  console.warn(
    'Order notification emails are off: set SMTP_HOST and ORDER_NOTIFY_EMAIL to turn them on.'
  )
}

/** Whole naira with thousands separators: 12500 -> "₦12,500". */
export const naira = (n) => `₦${Number(n ?? 0).toLocaleString('en-NG')}`

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const parseLabels = (raw) => {
  try {
    const labels = JSON.parse(raw ?? '[]')
    return Array.isArray(labels) ? labels.map(String) : []
  } catch {
    return []
  }
}

/** One item line: what it is, how it was chosen, and what that costs. */
function describeItem(item) {
  const details = [item.portion_label, ...parseLabels(item.option_labels)].filter(Boolean)
  return {
    name: item.name,
    details: details.join(', '),
    notes: item.notes || '',
    qty: item.qty,
    lineTotal: item.unit_price * item.qty,
  }
}

const heading = (label) =>
  `<h2 style="margin:0 0 6px;font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#666">${escapeHtml(label)}</h2>`

const row = (label, valueHtml) =>
  `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${escapeHtml(label)}</td><td style="padding:2px 0">${valueHtml}</td></tr>`

const totalRow = (label, valueHtml, bold = false) =>
  `<tr><td></td><td style="padding:4px 8px 2px 0;text-align:right;${bold ? 'font-weight:bold' : 'color:#666'}">${escapeHtml(label)}</td><td style="padding:4px 0 2px;text-align:right;${bold ? 'font-weight:bold' : ''}">${valueHtml}</td></tr>`

/**
 * Both the plain-text and HTML versions of the notification. Exported so the
 * layout can be checked without sending anything.
 */
export function buildOrderNotification(order, items) {
  const lines = items.map(describeItem)
  const isPickup = order.fulfilment === 'pickup'
  const paidAt = order.paid_at ? `${order.paid_at} UTC` : 'just now'
  const channel = order.payment_channel || 'Paystack'
  // Orders placed since delivery moved to pay-on-delivery carry no fee.
  const delivery =
    order.delivery_fee != null
      ? naira(order.delivery_fee)
      : isPickup
        ? 'none (pickup)'
        : 'paid by customer on delivery'
  const paystackRef = order.payment_reference || order.reference

  const subject = `New paid order ${order.reference} — ${naira(order.total)} (${
    isPickup ? 'pickup' : `delivery, ${order.zone_label}`
  })`

  const text = [
    `NEW PAID ORDER ${order.reference}`,
    `Paid ${paidAt} via ${channel}`,
    '',
    'CUSTOMER',
    `  ${order.customer_name}`,
    `  ${order.customer_phone || 'no phone given'}`,
    `  ${order.customer_email || 'no email'}`,
    order.user_id === null ? '  (guest checkout — no account)' : null,
    '',
    isPickup ? 'PICKUP' : 'DELIVERY',
    `  ${order.zone_label}`,
    isPickup ? null : `  ${order.address}`,
    order.wanted_for ? `  Wanted for: ${order.wanted_for}` : null,
    '',
    'ITEMS',
    ...lines.flatMap((l) => [
      `  ${l.qty} x ${l.name}${l.details ? ` (${l.details})` : ''} — ${naira(l.lineTotal)}`,
      l.notes ? `      note: ${l.notes}` : null,
    ]),
    '',
    `  Subtotal   ${naira(order.subtotal)}`,
    `  Delivery   ${delivery}`,
    `  TOTAL      ${naira(order.total)}`,
    '',
    order.notes ? `CUSTOMER NOTES\n  ${order.notes}\n` : null,
    `Paystack reference: ${paystackRef}`,
  ]
    .filter((line) => line !== null)
    .join('\n')

  const itemRows = lines
    .map((l) => {
      const details = l.details
        ? `<br><span style="color:#666">${escapeHtml(l.details)}</span>`
        : ''
      const notes = l.notes ? `<br><em>Note: ${escapeHtml(l.notes)}</em>` : ''
      return (
        '<tr>' +
        `<td style="padding:6px 8px 6px 0;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap">${l.qty} x</td>` +
        `<td style="padding:6px 8px 6px 0;border-bottom:1px solid #eee"><strong>${escapeHtml(l.name)}</strong>${details}${notes}</td>` +
        `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:top">${naira(l.lineTotal)}</td>` +
        '</tr>'
      )
    })
    .join('')

  const phone = order.customer_phone
    ? `<a href="tel:${escapeHtml(order.customer_phone)}">${escapeHtml(order.customer_phone)}</a>`
    : 'not given'
  const email = order.customer_email
    ? `<a href="mailto:${escapeHtml(order.customer_email)}">${escapeHtml(order.customer_email)}</a>`
    : 'not given'
  // Worth knowing at a glance: there is no order history to look back at,
  // and the details came from the form rather than an account.
  const guestNote = order.user_id === null
    ? '<span style="color:#666"> · guest checkout</span>'
    : ''

  const notesBlock = order.notes
    ? `${heading('Customer notes')}<p style="margin:0 0 16px;padding:10px 12px;background:#fdf6e3;border-radius:6px">${escapeHtml(order.notes)}</p>`
    : ''

  const html =
    '<!doctype html><html><body style="margin:0;padding:24px;background:#faf8f5;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#222">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:8px;padding:24px">' +
    '<p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#b8860b">New paid order</p>' +
    `<h1 style="margin:0 0 4px;font-size:22px">${escapeHtml(order.reference)}</h1>` +
    `<p style="margin:0 0 20px;color:#666">Paid ${escapeHtml(paidAt)} via ${escapeHtml(channel)}</p>` +
    heading('Customer') +
    '<table style="border-collapse:collapse;margin-bottom:20px">' +
    row('Name', escapeHtml(order.customer_name)) +
    row('Phone', phone) +
    row('Email', email + guestNote) +
    '</table>' +
    heading(isPickup ? 'Pickup' : 'Delivery') +
    '<table style="border-collapse:collapse;margin-bottom:20px">' +
    row('Zone', escapeHtml(order.zone_label)) +
    (isPickup ? '' : row('Address', escapeHtml(order.address))) +
    (order.wanted_for ? row('Wanted for', escapeHtml(order.wanted_for)) : '') +
    '</table>' +
    heading('Items') +
    '<table style="border-collapse:collapse;width:100%;margin-bottom:12px">' +
    itemRows +
    totalRow('Subtotal', naira(order.subtotal)) +
    totalRow('Delivery', delivery) +
    totalRow('Total paid', naira(order.total), true) +
    '</table>' +
    notesBlock +
    `<p style="margin:16px 0 0;font-size:12px;color:#999">Paystack reference ${escapeHtml(paystackRef)}</p>` +
    '</div></body></html>'

  return { subject, text, html }
}

/**
 * Email the kitchen about a paid order. Resolves either way and logs rather
 * than throws, because the caller is the payment settlement path and must
 * not fail over an email.
 */
export async function sendOrderNotification(order, items) {
  if (!mailEnabled) return false
  const message = buildOrderNotification(order, items)
  try {
    await transport().sendMail({
      from: mail.from,
      to: mail.orderNotifyTo,
      // Replying to the notification reaches the customer directly.
      replyTo: order.customer_email || undefined,
      ...message,
    })
    console.log(`Order notification sent for ${order.reference}`)
    return true
  } catch (error) {
    console.error(`Could not send the order notification for ${order.reference}:`, error)
    return false
  }
}
