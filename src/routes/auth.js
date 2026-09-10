import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { db, emailKey } from '../db.js'
import { Check, str } from '../lib/validate.js'
import { route, conflict, unauthorized, badRequest } from '../lib/errors.js'
import { issueSession, clearSession } from '../lib/session.js'
import { requireAuth } from '../middleware/auth.js'
import { throttle } from '../lib/throttle.js'

const router = Router()

const ROUNDS = 10

const insertUser = db.prepare(
  `INSERT INTO users (email, email_key, password_hash, name, phone)
   VALUES (?, ?, ?, ?, ?)`
)
const findByEmail = db.prepare('SELECT * FROM users WHERE email_key = ?')
const findById = db.prepare('SELECT id, email, name, phone, created_at FROM users WHERE id = ?')
const findHash = db.prepare('SELECT password_hash FROM users WHERE id = ?')
const updateProfile = db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?')
const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  phone: user.phone,
  createdAt: user.created_at,
})

const loginLimit = throttle({
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: 'Too many attempts.',
})

router.post(
  '/register',
  throttle({ max: 5, windowMs: 60 * 60 * 1000, message: 'Too many sign-ups from here.' }),
  route(async (req, res) => {
    const check = new Check()
    check.text('name', req.body?.name, { label: 'Full name', min: 2, max: 120 })
    check.email('email', req.body?.email)
    check.password('password', req.body?.password)
    const phone = str(req.body?.phone)
    if (phone) check.phone('phone', phone)
    check.done()

    const email = str(req.body.email)
    const key = emailKey(email)
    if (findByEmail.get(key)) {
      throw conflict('An account with that email already exists. Try signing in instead.')
    }

    const hash = await bcrypt.hash(req.body.password, ROUNDS)
    const { lastInsertRowid } = insertUser.run(email, key, hash, str(req.body.name), phone)
    const user = findById.get(Number(lastInsertRowid))

    issueSession(res, user)
    res.status(201).json({ user: publicUser(user) })
  })
)

router.post(
  '/login',
  loginLimit,
  route(async (req, res) => {
    const check = new Check()
    check.email('email', req.body?.email)
    if (!req.body?.password) check.add('password', 'Password is required.')
    check.done()

    const user = findByEmail.get(emailKey(str(req.body.email)))
    // Always run a comparison so a missing account and a wrong password take
    // roughly the same time and cannot be told apart by timing.
    const hash = user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvaliduO'
    const ok = await bcrypt.compare(req.body.password, hash)

    if (!user || !ok) throw unauthorized('Those details do not match an account.')

    issueSession(res, user)
    res.json({ user: publicUser(user) })
  })
)

router.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

router.patch(
  '/me',
  requireAuth,
  route(async (req, res) => {
    const check = new Check()
    check.text('name', req.body?.name, { label: 'Full name', min: 2, max: 120 })
    const phone = str(req.body?.phone)
    if (phone) check.phone('phone', phone)
    check.done()

    updateProfile.run(str(req.body.name), phone, req.user.id)
    res.json({ user: publicUser(findById.get(req.user.id)) })
  })
)

router.post(
  '/password',
  requireAuth,
  route(async (req, res) => {
    const check = new Check()
    if (!req.body?.currentPassword) check.add('currentPassword', 'Enter your current password.')
    check.password('newPassword', req.body?.newPassword)
    check.done()

    const { password_hash: hash } = findHash.get(req.user.id)
    if (!(await bcrypt.compare(req.body.currentPassword, hash))) {
      throw badRequest('Please check the highlighted fields.', {
        currentPassword: 'That is not your current password.',
      })
    }

    updatePassword.run(await bcrypt.hash(req.body.newPassword, ROUNDS), req.user.id)
    // Re-issue so the cookie lifetime restarts after a password change.
    issueSession(res, req.user)
    res.json({ ok: true })
  })
)

export default router
