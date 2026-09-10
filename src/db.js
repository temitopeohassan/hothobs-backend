import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true })

export const db = new DatabaseSync(config.databaseFile)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL,
    email_key     TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    phone         TEXT    NOT NULL DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reference      TEXT    NOT NULL UNIQUE,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    customer_name  TEXT    NOT NULL,
    customer_phone TEXT    NOT NULL,
    customer_email TEXT    NOT NULL DEFAULT '',
    fulfilment     TEXT    NOT NULL,
    zone_id        TEXT    NOT NULL,
    zone_label     TEXT    NOT NULL,
    address        TEXT    NOT NULL DEFAULT '',
    wanted_for     TEXT    NOT NULL DEFAULT '',
    notes          TEXT    NOT NULL DEFAULT '',
    payment_method TEXT    NOT NULL,
    subtotal       INTEGER NOT NULL,
    delivery_fee   INTEGER,
    total          INTEGER NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'placed',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, id DESC);

  CREATE TABLE IF NOT EXISTS order_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    slug          TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    portion_label TEXT    NOT NULL DEFAULT '',
    option_labels TEXT    NOT NULL DEFAULT '[]',
    notes         TEXT    NOT NULL DEFAULT '',
    tone          TEXT    NOT NULL DEFAULT 'gold',
    unit_price    INTEGER NOT NULL,
    qty           INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id);
`)

/**
 * Payment state, added when checkout moved to Paystack.
 *
 * Kept as ALTER TABLEs rather than folded into CREATE TABLE above so an
 * existing database picks them up on the next boot. `payment_status` is
 * the one that matters: 'pending' until Paystack tells us otherwise,
 * then 'paid', 'failed' or 'abandoned'.
 */
const orderColumns = new Set(
  db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name)
)
const addColumn = (name, definition) => {
  if (!orderColumns.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`)
}

addColumn('payment_status', "TEXT NOT NULL DEFAULT 'pending'")
addColumn('payment_reference', "TEXT NOT NULL DEFAULT ''")
addColumn('payment_channel', "TEXT NOT NULL DEFAULT ''")
addColumn('payment_amount', 'INTEGER')
addColumn('paid_at', 'TEXT')

db.exec('CREATE INDEX IF NOT EXISTS orders_payment_idx ON orders(payment_reference)')

export const emailKey = (email) => email.trim().toLowerCase()
