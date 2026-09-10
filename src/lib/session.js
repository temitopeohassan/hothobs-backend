import jwt from 'jsonwebtoken'
import { config, isProduction } from '../config.js'

export const COOKIE_NAME = 'hothobs_session'

const maxAgeMs = () => config.sessionDays * 24 * 60 * 60 * 1000

const cookieOptions = () => ({
  httpOnly: true,
  // SameSite=None requires Secure; only use it when the API is on another domain.
  sameSite: config.crossSiteCookies ? 'none' : 'lax',
  secure: config.crossSiteCookies || isProduction,
  path: '/',
})

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  })
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: maxAgeMs() })
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions())
}

export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME]
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const id = Number(payload.sub)
    return Number.isInteger(id) ? id : null
  } catch {
    return null
  }
}
