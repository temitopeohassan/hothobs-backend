import { badRequest } from './errors.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const str = (value) => (typeof value === 'string' ? value.trim() : '')

/**
 * Collects every problem before throwing so the form can highlight all the
 * bad fields at once rather than one per round trip.
 */
export class Check {
  constructor() {
    this.fields = {}
  }

  add(field, message) {
    if (!this.fields[field]) this.fields[field] = message
    return this
  }

  email(field, value) {
    const email = str(value)
    if (!email) return this.add(field, 'Email address is required.')
    if (email.length > 254 || !EMAIL.test(email)) this.add(field, 'That does not look like an email address.')
    return this
  }

  password(field, value) {
    const password = typeof value === 'string' ? value : ''
    if (!password) return this.add(field, 'Password is required.')
    if (password.length < 8) this.add(field, 'Use at least 8 characters.')
    // bcrypt silently truncates beyond 72 bytes, so reject rather than mislead.
    else if (Buffer.byteLength(password) > 72) this.add(field, 'Password is too long (72 bytes maximum).')
    return this
  }

  text(field, value, { label, min = 1, max = 200 } = {}) {
    const text = str(value)
    if (text.length < min) this.add(field, `${label ?? field} is required.`)
    else if (text.length > max) this.add(field, `${label ?? field} must be ${max} characters or fewer.`)
    return this
  }

  phone(field, value) {
    const phone = str(value)
    if (!phone) return this.add(field, 'Phone number is required.')
    const digits = phone.replace(/[^\d]/g, '')
    if (digits.length < 7 || digits.length > 15) this.add(field, 'That does not look like a phone number.')
    return this
  }

  done(message = 'Please check the highlighted fields.') {
    if (Object.keys(this.fields).length) throw badRequest(message, this.fields)
  }
}
