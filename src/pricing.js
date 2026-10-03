/* ---------- Pricing ----------
   The commercial facts about each product, kept in their own module so that the
   checkout page and the order endpoint read them from exactly one place.

   Why this is separate from `catalogue.js`: that module reaches for `window`
   and `localStorage` to run the cart, so it cannot be loaded inside a Cloudflare
   Worker. The server has to price an order from its own catalogue rather than
   believing whatever total the browser sent — otherwise anyone could post
   `{"total": 1}` and buy the shop. That check is only trustworthy if both sides
   are reading the same numbers, so the prices live here and `catalogue.js`
   layers the presentation (photographs, labels, copy) on top.

   `image`, `art` and the marketing copy stay in `catalogue.js`: the server has
   no use for them, and a missing photograph must never be able to affect a
   price. */

export const PREORDER_NOTICE_DAYS = 2;

export const pricing = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 1999,
  },
  'one-litre': {
    name: 'One-litre ghee',
    size: '1 L',
    price: 3999,
  },
  butter: {
    name: 'Cultured butter',
    size: '500 g',
    price: 1799,
    preorder: true,
  },
  curd: {
    name: 'Set curd',
    size: '800 g',
    price: 249,
    preorder: true,
  },
};

export const pricingKeys = Object.keys(pricing);

/* Largest quantity the cart allows of any one product. Mirrors the clamp in
   `readCart`, so a hand-crafted request cannot ask for a hundred jars and
   quietly become a ₹399,900 order. */
export const MAX_QUANTITY = 9;

/* Rupees, to the nearest whole number — Indian food prices have no paise in
   practice and the shop never shows fractions. */
export function formatRupees(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/* Turns a submitted cart into priced lines, discarding anything unrecognised.

   This is the server's version of `cartEntries` + `cartTotal` in `catalogue.js`.
   It returns the priced result rather than a total alone so the owner sees the
   same breakdown the customer did, and so a mismatch is obvious in the sheet. */
export function priceCart(cart) {
  if (!cart || typeof cart !== 'object') return { lines: [], total: 0, hasPreorder: false };
  const lines = pricingKeys
    .map((key) => {
      const quantity = Math.trunc(Number(cart[key]));
      if (!Number.isFinite(quantity) || quantity <= 0) return null;
      const product = pricing[key];
      return {
        key,
        name: product.name,
        size: product.size,
        preorder: Boolean(product.preorder),
        quantity: Math.min(quantity, MAX_QUANTITY),
        unitPrice: product.price,
        lineTotal: product.price * Math.min(quantity, MAX_QUANTITY),
      };
    })
    .filter(Boolean);
  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    hasPreorder: lines.some((line) => line.preorder),
  };
}

/* "2 × Cultured butter (500 g)" — the one-line version stored alongside the
   structured lines, so the sheet is readable without unpicking JSON. */
export function summariseLines(lines) {
  return lines.map((line) => `${line.quantity} × ${line.name} (${line.size})`).join(', ');
}

/* ---------- Delivery dates ----------

   The date picker in the browser and the check that rejects a bad date on the
   server both read these rules from here. If they lived in two places a
   customer could be shown an acceptable date and then have the order refused,
   which reads as a broken shop rather than a rule. */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; /* India has no daylight saving. */

/* Ready-stock jars are dispatched the next day; a preorder item cannot be made
   until the churn that produces it, so it carries the full notice period. */
export const MIN_DELIVERY_DAYS_READY = 1;
export const MAX_DELIVERY_DAYS = 180;

export function minimumDeliveryDays(hasPreorder) {
  return hasPreorder ? PREORDER_NOTICE_DAYS : MIN_DELIVERY_DAYS_READY;
}

/* The farm is in Andhra Pradesh, so "today" means today in IST. Deriving it in
   UTC would move the earliest allowed date by a day for anyone ordering in the
   evening, which is most of them. */
export function todayInIST(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return new Date(parsed.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function earliestDeliveryDate(hasPreorder, now = Date.now()) {
  return addDays(todayInIST(now), minimumDeliveryDays(hasPreorder));
}

export function latestDeliveryDate(now = Date.now()) {
  return addDays(todayInIST(now), MAX_DELIVERY_DAYS);
}