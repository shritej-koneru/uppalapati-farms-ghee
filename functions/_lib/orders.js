/* ---------- Order intake ----------

   Everything a request is allowed to say about an order, checked here before a
   single row is written.

   The browser fills in a nice form and sends what the customer typed. None of
   that is evidence. The total is recomputed from `pricing.js`, the delivery
   date is checked against the same window the date picker offered, and the
   products are looked up by key so a request cannot invent one. A rejected
   request writes nothing. */

import { priceCart, summariseLines, earliestDeliveryDate, latestDeliveryDate, PREORDER_NOTICE_DAYS } from '../../src/pricing.js';
import { isOrderStatus, DEFAULT_STATUS } from '../../src/order-status.js';

/* A hidden field a person cannot see or tab to.

   A filled honeypot does not drop the order. It marks it `flagged` and stores
   it as normal, because password managers and autofill do sometimes write into
   hidden inputs — and silently discarding what a customer believed they had
   ordered is far worse than one junk row the owner can sort out. Marking it
   instead means a bot is told nothing about why it was caught. */
const HONEYPOT_FIELD = 'company';

/* Deliberately permissive. Customers paste numbers from receipts and address
   books, and a shop that rejects "919908854444" loses the sale rather than the
   spam. What it will not accept is anything that is not ten digits starting 6-9,
   because that is what WhatsApp cannot reach. */
function normaliseMobile(value) {
  const digits = String(value ?? '').replace(/[\s()-]/g, '').replace(/^0+/, '');
  const local = digits.replace(/^(?:0?91|0091)/, '');
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

function clean(value, { min, max }) {
  const text = String(value ?? '')
    .replace(/\p{Cc}/gu, '')
    .trim();
  if (text.length < min || text.length > max) return null;
  return text;
}

/* A real calendar date that is not 2026-02-31. The shape check alone would let
   that through, and `new Date` would roll it into March. */
function parseDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === text ? text : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isHoneypotFilled(body) {
  /* Any value at all means something filled in a field a person cannot see.
     Checked against the raw string rather than through `clean`, so an
     over-long value still counts as filled in. */
  return Boolean(String(body?.[HONEYPOT_FIELD] ?? '').trim());
}

export function validateOrder(body) {
  const errors = {};

  const priced = priceCart(body?.cart);
  if (priced.lines.length === 0) {
    errors.cart = 'Choose at least one product before placing an order.';
  }

  const fullName = clean(body?.fullName, { min: 2, max: 80 });
  if (!fullName || !/\p{L}/u.test(fullName)) {
    errors.fullName = 'Enter the name the order should be made out to.';
  }

  const mobile = normaliseMobile(body?.mobile);
  if (!mobile) {
    errors.mobile = 'Enter a 10-digit mobile number we can reach you on.';
  }

  const emailRaw = clean(body?.email, { min: 0, max: 120 });
  const email = emailRaw || null;
  if (email && !EMAIL.test(email)) {
    errors.email = 'That email address does not look right.';
  }

  const address = clean(body?.address, { min: 8, max: 240 });
  if (!address) errors.address = 'Enter the address the order should go to.';

  const city = clean(body?.city, { min: 2, max: 80 });
  if (!city) errors.city = 'Enter a town or city.';

  const state = clean(body?.state, { min: 2, max: 80 });
  if (!state) errors.state = 'Enter a state.';

  const pincode = clean(body?.pincode, { min: 6, max: 6 });
  if (!pincode || !/^[1-9]\d{5}$/.test(pincode)) errors.pincode = 'Enter a valid 6-digit PIN code.';

  const deliveryDate = parseDate(body?.deliveryDate);
  if (!deliveryDate) {
    errors.deliveryDate = 'Choose a delivery date.';
  } else {
    const earliest = earliestDeliveryDate(priced.hasPreorder);
    const latest = latestDeliveryDate();
    if (deliveryDate < earliest || deliveryDate > latest) {
      /* Two different corrections. "or later" is only true for a date that is
         too early; a date beyond the booking horizon needs an upper bound too. */
      const range =
        deliveryDate < earliest
          ? `Choose ${earliest} or later`
          : `Choose a date between ${earliest} and ${latest}`;
      errors.deliveryDate = priced.hasPreorder
        ? `${range} — butter and curd are made to order and need ${PREORDER_NOTICE_DAYS} days notice.`
        : `${range}.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    order: {
      fullName,
      mobile,
      email,
      address,
      city,
      state,
      pincode,
      deliveryDate,
      lines: priced.lines,
      itemSummary: summariseLines(priced.lines),
      total: priced.total,
      hasPreorder: priced.hasPreorder ? 1 : 0,
    },
  };
}

/* ---------- Writing ----------

   The reference the owner reads back over the phone is taken from a counter
   bumped in a single statement, so two orders arriving at once cannot be handed
   the same number. The column is incremented before the row is written, which
   means a reference is never reused — the reverse of what a "SELECT count(*)
   then insert" would do under load. */

export async function nextReference(env) {
  const row = await env.GHEE_ORDERS.prepare(
    "UPDATE counters SET value = value + 1 WHERE name = 'order' RETURNING value",
  ).first();
  const sequence = Number(row?.value);
  if (!Number.isFinite(sequence)) throw new Error('order counter did not return a value');
  const year = new Date().getUTCFullYear();
  return `UP-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function saveOrder(env, order, requestKey, flagged = false) {
  const reference = await nextReference(env);
  const createdAt = new Date().toISOString();

  await env.GHEE_ORDERS.prepare(
    `INSERT INTO orders
       (id, reference, request_key, created_at, full_name, mobile, email, address,
        city, state, pincode, delivery_date, items, item_summary, total, has_preorder, flagged, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
  )
    .bind(
      crypto.randomUUID(),
      reference,
      requestKey ?? null,
      createdAt,
      order.fullName,
      order.mobile,
      order.email,
      order.address,
      order.city,
      order.state,
      order.pincode,
      order.deliveryDate,
      JSON.stringify(order.lines),
      order.itemSummary,
      order.total,
      order.hasPreorder,
      flagged ? 1 : 0,
      /* Written rather than left to the column default: every other column is
         named here, and an order that lands without a status would leave the
         sheet and the page counting on a guess. */
      DEFAULT_STATUS,
    )
    .run();

  return { reference, createdAt };
}

/* A double-tapped submit button, or a retry over a slow connection, would
   otherwise create two identical orders. The browser sends one key per checkout
   attempt and a repeat of that key returns the order already recorded. */
export async function findByRequestKey(env, requestKey) {
  if (!requestKey || typeof requestKey !== 'string' || requestKey.length > 64) return null;
  const row = await env.GHEE_ORDERS.prepare(
    'SELECT reference, created_at FROM orders WHERE request_key = ?1',
  )
    .bind(requestKey)
    .first();
  return row ? { reference: row.reference, createdAt: row.created_at } : null;
}

export async function listOrders(env) {
  const result = await env.GHEE_ORDERS.prepare(
    `SELECT reference, created_at, full_name, mobile, email, address, city, state,
            pincode, delivery_date, items, item_summary, total, has_preorder, notified, flagged, status
       FROM orders
      ORDER BY created_at DESC`,
  ).all();
  return result.results ?? [];
}

/* ---------- Moving an order on ----------

   The owner's only write to an order that already exists. Three guards, all of
   them load-bearing: the status must be one of the five in `order-status.js`,
   the reference must look like a reference rather than being passed through to
   the query, and the update matches on `reference`, which carries a UNIQUE index,
   so at most one row can ever be affected and a crafted value cannot reach
   another's.

   Returns the status now stored. `reason` says which guard stopped it — `status`
   and `reference` are 422s the caller can act on, `missing` means the row is not
   there at all, which is a 404 rather than a success that changed nothing. */
export async function setOrderStatus(env, reference, status) {
  const normalised = String(reference ?? '').trim().toUpperCase();

  if (!/^UP-\d{4}-\d{4,}$/.test(normalised)) return { ok: false, reason: 'reference' };
  if (!isOrderStatus(status)) return { ok: false, reason: 'status' };

  /* Read back in the same statement that writes. `RETURNING` gives the value
     actually stored, so the page and the sheet cannot end up disagreeing about
     one order, and an empty result is how "no such order" is detected without a
     second round trip that could race with another change. */
  const row = await env.GHEE_ORDERS.prepare(
    'UPDATE orders SET status = ?1 WHERE reference = ?2 RETURNING status',
  )
    .bind(status, normalised)
    .first();

  if (!row) return { ok: false, reason: 'missing' };
  return { ok: true, reference: normalised, status: row.status };
}
