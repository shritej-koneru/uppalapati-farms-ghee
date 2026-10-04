-- Order storage for Uppalapati Farms.
--
-- Run against a fresh database with:
--   npx wrangler d1 execute ghee-orders --remote --file=db/schema.sql
--
-- Everything is IF NOT EXISTS, so this is safe to re-run and safe to run against
-- the live database to add anything that is missing.
--
-- Why a database and not a spreadsheet: an .xlsx file is a zip archive that
-- cannot be appended to. Adding a row means rewriting the whole file, so two
-- orders arriving together race and one is lost. Orders are recorded here and
-- the owner downloads a generated sheet on demand — see functions/_lib/xlsx.js.

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  -- Human-readable, spoken over the phone: 041026-005, which reads as "the
  -- fourth of October 2026, fifth order". The date is the farm's local day, not
  -- the server's, and the sequence counts within that day. Comes from the
  -- counters table below rather than from a row count, so two orders arriving
  -- at once cannot be given the same number.
  reference     TEXT NOT NULL,
  -- One key per checkout attempt. A repeat of the same key returns the order
  -- already recorded instead of writing a second one, so a double-tapped
  -- button or a retry over a slow connection cannot double-order.
  request_key   TEXT,
  created_at    TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  mobile        TEXT NOT NULL,
  email         TEXT,
  address       TEXT NOT NULL,
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  pincode       TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  -- JSON array of priced lines, kept so a single order's breakdown survives even
  -- if the catalogue changes later.
  items         TEXT NOT NULL,
  -- The same lines flattened into one readable string, so the sheet is legible
  -- without unpicking JSON.
  item_summary  TEXT NOT NULL,
  total         INTEGER NOT NULL,
  has_preorder  INTEGER NOT NULL DEFAULT 0,
  -- 1 once a new-order email has gone out. Kept for when email is switched on;
  -- the column exists now so enabling it later is not a migration.
  notified      INTEGER NOT NULL DEFAULT 0,
  -- 1 when the request tripped the honeypot. The order is still recorded — a
  -- password manager writing into a hidden field must never cost a customer
  -- their order — but the owner can sort these out in one pass.
  flagged       INTEGER NOT NULL DEFAULT 0,
  -- Where the owner has got to with this order: pending, contacted, on-the-way,
  -- completed or canceled. The permitted values live in src/order-status.js and
  -- are checked there rather than by a CHECK constraint, so an unexpected value
  -- comes back as a readable refusal instead of a database error nobody can act
  -- on. Added by migration rather than in the CREATE TABLE on installs that
  -- predate it — see db/migrations/.
  status        TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_reference ON orders (reference);

-- Partial, because most rows will have no request key and SQLite treats NULLs
-- as distinct in a unique index anyway; being explicit keeps that intent clear.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_request
  ON orders (request_key) WHERE request_key IS NOT NULL;

-- Counters, keyed by name. The order sequence is one row per day —
-- `order-041026` — written by the upsert in functions/_lib/orders.js rather than
-- seeded here, because the set of days is not known until orders arrive. The
-- upsert is a single statement, so the counter cannot be incremented twice for
-- one order or missed entirely: that is what keeps references unique under load.
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- Throttles sign-in attempts. Holds a keyed hash of the visitor's address, never
-- the address itself, and rows for old windows are deleted as they expire.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_key         TEXT NOT NULL,
  window_started INTEGER NOT NULL,
  failures       INTEGER NOT NULL,
  PRIMARY KEY (ip_key, window_started)
);
