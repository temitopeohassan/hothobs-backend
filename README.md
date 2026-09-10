# hothobs-backend

API for Hothobs Cuisines — customer accounts, authentication and orders.

Node + Express, with SQLite through Node's built-in `node:sqlite` module (so there
is no native module to compile). Requires **Node 22.5 or newer**; developed on 24.

## Getting started

```bash
npm install
cp .env.example .env          # then fill in JWT_SECRET
npm run dev                   # http://localhost:4000
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The database file is created automatically on first run at `data/hothobs.db`.
The schema is applied on every boot with `CREATE TABLE IF NOT EXISTS`, so there
is no separate migration step yet.

The frontend reads its API base URL from `VITE_API_URL` in
`../hothobs-frontend/.env` — it must point at this server plus `/api`.

## How sessions work

Signing in sets an **httpOnly** cookie (`hothobs_session`) holding a JWT signed
with `JWT_SECRET`. The browser never sees the token from JavaScript, which keeps
it out of reach of XSS. Passwords are hashed with bcrypt.

Because the cookie is httpOnly, every request from the site must send
`credentials: 'include'` — the frontend's `src/lib/api.js` already does.

Set `CROSS_SITE_COOKIES=true` in production **only** when the API is on a
different domain from the site (for example
`api.hothobscuisines.com` vs `hothobscuisines.com`). That switches the cookie to
`SameSite=None; Secure`, which requires HTTPS on both.

## Endpoints

All paths are prefixed with `/api`.

| Method | Path                | Auth     | Purpose |
| ------ | ------------------- | -------- | ------- |
| GET    | `/health`           | —        | Liveness check |
| GET    | `/zones`            | —        | Delivery zones, their fees, and the payment methods |
| POST   | `/auth/register`    | —        | Create an account, signs in |
| POST   | `/auth/login`       | —        | Sign in |
| POST   | `/auth/logout`      | —        | Clear the session cookie |
| GET    | `/auth/me`          | required | The signed-in customer |
| PATCH  | `/auth/me`          | required | Update name and phone |
| POST   | `/auth/password`    | required | Change password |
| POST   | `/orders`           | required | Place an order and start its Paystack payment |
| GET    | `/orders`           | required | Order history, newest first |
| GET    | `/orders/:reference`| required | One order, if it belongs to the caller |
| POST   | `/payments/verify`  | required | Ask Paystack how a payment ended |
| POST   | `/payments/webhook` | signed   | Paystack's own notification |

Validation failures return `400` with a `fields` object keyed by form field, so
the UI can highlight each input:

```json
{ "error": "Please check the highlighted fields.",
  "fields": { "email": "That does not look like an email address." } }
```

Login and registration are rate limited per IP and email (8 sign-in attempts per
15 minutes, 5 sign-ups per hour). The limiter is in memory, so move it to Redis
if the API is ever run on more than one instance.

## Payment

**Paystack is the only way to pay.** There is no bank transfer and no
cash-on-delivery path — an order is placed by paying for it, so the kitchen
never starts cooking against a promise.

The flow is Paystack's redirect ("Standard") flow:

1. `POST /api/orders` prices the order, writes it as `payment_status = 'pending'`
   and asks Paystack to initialise a transaction. The order reference (`HH-XXXXX`)
   is used as the Paystack reference, so a webhook can find the order directly.
2. The browser is sent to the `authorization_url` Paystack returned. Card details
   never touch this server.
3. Paystack redirects the customer back to `SITE_URL/order/complete?reference=…`,
   and the site calls `POST /api/payments/verify`.
4. Independently, Paystack calls `POST /api/payments/webhook`. **This is the one
   that matters** — a customer who pays and then closes the tab never reaches
   step 3. Set the webhook URL in the Paystack dashboard.

An order is only marked paid from a response fetched from Paystack — a verify
call or a signature-checked webhook. Nothing the browser says can mark an order
paid. Both paths run the same `settle()` and are safe to arrive twice or out of
order. A successful transaction whose amount does not match the order total is
logged and deliberately left unpaid for staff to look at.

Configure `PAYSTACK_SECRET_KEY`, `PAYSTACK_CURRENCY` and `SITE_URL` — see
`.env.example`. Without a secret key the checkout refuses orders rather than
quietly accepting unpaid ones.

Delivery outside Lagos has no fixed fee, so it cannot be paid for online; that
zone is rejected at checkout with a note to call the kitchen.

### Regenerating prices

`src/lib/catalogue.data.json` is the server's copy of the menu and the authority
on what a customer is charged. The browser sends only ids — slug, portion id,
option ids and quantity — and `src/lib/catalogue.js` prices the line. When the
menu changes in `../hothobs-frontend/src/data/menu.js`, regenerate it:

```bash
node --input-type=module -e "
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
const m = await import(pathToFileURL('../hothobs-frontend/src/data/menu.js').href)
fs.writeFileSync('src/lib/catalogue.data.json', JSON.stringify(m.products.map(p => ({
  slug: p.slug, name: p.name, tone: p.tone,
  portions: p.portions.map(x => ({ id: x.id, label: x.label, price: x.price })),
  options: p.options.map(o => ({ id: o.id, label: o.label,
    choices: o.choices.map(c => ({ id: c.id, label: c.label, price: c.price })) })),
})), null, 2) + '
')
"
```

A price that exists in only one of the two files is a bug: the customer sees one
number and is charged another.

## Checkout requires an account

There is no guest checkout. `POST /orders` requires a session, so every order is
attached to a customer and appears in their order history, and the email on an
order is always the account's own.

`orders.user_id` is still nullable, for two reasons: orders placed before this
rule came in, and `ON DELETE SET NULL` when an account is removed.

If guest checkout is ever wanted again, swap `requireAuth` back to `optionalAuth`
on that route and restore the email field on the checkout form. Do **not** then
link old guest orders to a new account by matching email — that would hand one
customer's address and phone to anyone who registered with their address.
Linking them safely needs email verification first.

## Before launch

- [ ] Replace the placeholder delivery zones and fees in `src/lib/fulfilment.js`.
- [x] **Price order lines on the server.** Done — the browser sends ids and
      `src/lib/catalogue.js` prices every line. Required before taking money.
- [ ] Move the catalogue into the database so it stops being a second copy of
      the frontend's menu file (see 'Regenerating prices' above).
- [ ] Go live on Paystack: swap `sk_test_` for the live secret key, point
      `SITE_URL` at the real domain, and set the webhook URL in the dashboard.
- [ ] Add password reset (needs an email provider).
- [ ] Add email verification on registration.
- [ ] Point `DATABASE_FILE` at a persistent disk, and take backups. Consider
      moving to Postgres if the admin app will read the same data concurrently.
- [ ] Order status is stored on `orders.status` (defaults to `placed`) but
      nothing updates it yet — that belongs to the admin app.

## Licence

See [LICENSE](LICENSE).
