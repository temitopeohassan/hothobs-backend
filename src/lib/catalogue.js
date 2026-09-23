/**
 * ─────────────────────────────────────────────────────────────
 *  THE PRICED CATALOGUE — this file is the authority on money
 * ─────────────────────────────────────────────────────────────
 *  Every naira a customer is charged is worked out here, from ids the
 *  browser sends. The browser never sends a price: it sends what was
 *  chosen (slug, portion id, option ids, quantity) and the server prices
 *  it. Anything else would let someone edit a request and pay ₦1 for a
 *  ₦50,000 order, which matters now that checkout takes real money
 *  through Paystack.
 *
 *  catalogue.data.json mirrors hothobs-frontend/src/data/menu.js. It also
 *  carries each product's `minQty`, the order minimum Hothobs prints —
 *  twenty people for a breakfast spread, twenty packs for a Black Pack.
 *  The browser applies the same floor, but the browser can be edited, so
 *  priceLine is where it actually holds. Regenerate after any menu change
 *  with:
 *
 *    node --input-type=module -e "…"   (see README, 'Regenerating prices')
 *
 *  A price that exists in only one of the two files is a bug: the
 *  customer sees one number and is charged another.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const products = require('./catalogue.data.json')

const bySlug = new Map(products.map((p) => [p.slug, p]))

export const findProduct = (slug) => bySlug.get(slug) ?? null

/**
 * Price one cart line from ids alone.
 *
 * `options` is { [optionGroupId]: choiceId }. A group the browser leaves
 * out falls back to its first choice, which is what the quick-add button
 * on a product card means by "no choices made".
 *
 * Returns the priced line, or a { error } describing what did not resolve,
 * optionally with `advice` telling the customer how to put it right.
 * Never returns a price derived from anything the client sent.
 */
export function priceLine({ slug, portionId, options, qty }) {
  const product = findProduct(slug)
  if (!product) return { error: 'is no longer on the menu' }

  // The order minimum is Hothobs' own, printed on the menu. Checking it
  // here rather than only in the browser is the difference between a rule
  // and a suggestion.
  const minQty = product.minQty ?? 1
  if (minQty > 1 && qty < minQty) {
    const noun = product.unitNoun ?? 'portions'
    return {
      error: `has a minimum order of ${minQty} ${noun}`,
      // Removing the item is the wrong advice here — the order is fine, the
      // quantity is simply short. Callers fall back to their own wording
      // when an error carries no advice of its own.
      advice: `Please raise ${product.name} to at least ${minQty} ${noun} and try again.`,
    }
  }

  const portion =
    product.portions.find((p) => p.id === portionId) ??
    (product.portions.length === 1 ? product.portions[0] : null)
  if (!portion) return { error: 'has a portion we do not recognise' }

  const chosen = []
  for (const group of product.options) {
    const wanted = options?.[group.id]
    const choice =
      group.choices.find((c) => c.id === wanted) ?? (wanted == null ? group.choices[0] : null)
    if (!choice) return { error: `has a "${group.label}" choice we do not recognise` }
    chosen.push({ groupId: group.id, id: choice.id, label: choice.label, price: choice.price })
  }

  const unitPrice = portion.price + chosen.reduce((n, c) => n + c.price, 0)
  if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    return { error: 'priced to something we cannot charge' }
  }

  return {
    line: {
      slug: product.slug,
      name: product.name,
      tone: product.tone,
      portionId: portion.id,
      portionLabel: portion.label,
      optionIds: Object.fromEntries(chosen.map((c) => [c.groupId, c.id])),
      optionLabels: chosen.map((c) => c.label),
      unitPrice,
      qty,
    },
  }
}
