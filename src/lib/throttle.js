import { tooMany } from './errors.js'

/**
 * Small in-memory attempt limiter for the credential endpoints. Good enough for
 * a single-instance deployment; move to Redis if the API is ever load balanced.
 */
export function throttle({ max, windowMs, message }) {
  const hits = new Map()

  const sweep = () => {
    const now = Date.now()
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key)
  }

  return (req, _res, next) => {
    if (hits.size > 5000) sweep()
    const now = Date.now()
    const key = `${req.ip}|${String(req.body?.email ?? '').toLowerCase()}`
    const entry = hits.get(key)

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (entry.count >= max) {
      const minutes = Math.max(1, Math.ceil((entry.resetAt - now) / 60000))
      return next(tooMany(`${message} Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`))
    }
    entry.count += 1
    next()
  }
}
