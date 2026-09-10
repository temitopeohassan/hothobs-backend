import { db } from '../db.js'
import { readSession } from '../lib/session.js'
import { unauthorized } from '../lib/errors.js'

const findUser = db.prepare(
  'SELECT id, email, name, phone, created_at FROM users WHERE id = ?'
)

/** Attaches req.user when a valid session cookie is present; never rejects. */
export function optionalAuth(req, _res, next) {
  const id = readSession(req)
  req.user = id ? (findUser.get(id) ?? null) : null
  next()
}

/** Rejects with 401 unless a valid session is present. */
export function requireAuth(req, _res, next) {
  const id = readSession(req)
  const user = id ? findUser.get(id) : null
  if (!user) return next(unauthorized())
  req.user = user
  next()
}
