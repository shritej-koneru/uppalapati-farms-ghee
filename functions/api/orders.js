/* ---------- /api/orders ----------

   Two very different jobs share one route because they answer the same
   question — "what orders exist?" — from two very different callers.

   POST is public. Anyone can place an order, so it validates everything, prices
   the cart from the server's own catalogue, and returns only the reference.

   GET is not public. It reads the whole order book, names, numbers and
   addresses included, and is refused without a signed-in owner session. There
   is no "list" query that returns a subset to an anonymous caller, because a
   subset is still customer data. */

import { json, refuse, readJson } from '../_lib/http.js';
import { isSignedIn } from '../_lib/session.js';
import { validateOrder, isHoneypotFilled, saveOrder, findByRequestKey, listOrders } from '../_lib/orders.js';
import { buildWorkbook } from '../_lib/xlsx.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  if (!body) return refuse('Malformed request.');

  const result = validateOrder(body);
  if (!result.ok) {
    /* 422 rather than 400: the request was well-formed, the contents were not.
       The field map lets the checkout page put each message next to the input
       it belongs to instead of showing one lumped-up sentence. */
    return json({ ok: false, errors: result.errors }, 422);
  }

  /* A retry of a request already recorded returns the original order rather
     than creating a second one. Checked before writing so the common case — a
     double-tap or a resend over a slow connection — costs nothing. */
  const requestKey = typeof body.requestKey === 'string' ? body.requestKey : null;
  const existing = await findByRequestKey(env, requestKey);
  if (existing) return json({ ok: true, ...existing, duplicate: true });

  const saved = await saveOrder(env, result.order, requestKey, isHoneypotFilled(body));
  return json({ ok: true, ...saved }, 201);
}

export async function onRequestGet({ request, env }) {
  if (!(await isSignedIn(request, env))) {
    return refuse('Sign in to view orders.', 401);
  }

  const orders = await listOrders(env);

  /* Pages Functions do not put a parsed URL on the context, so it is read off
     the request. Passing `?format=xlsx` rather than a second route keeps
     `/api/orders` and the export as one endpoint with one auth check. */
  const url = new URL(request.url);

  if (url.searchParams.get('format') === 'xlsx') {
    const workbook = buildWorkbook(SHEET_COLUMNS, orders.map(toSheetRow));
    return new Response(workbook, {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="uppalapati-orders-${todayStamp()}.xlsx"`,
        'cache-control': 'no-store',
      },
    });
  }

  return json({ ok: true, orders });
}

/* The sheet is the owner's working document, so it carries the columns needed
   to pick, pack and invoice an order without opening anything else: who, where,
   when, what, how much. `Notified` and `Flagged` are the two housekeeping
   columns — the first marks orders an email has already gone out for, the second
   marks rows a bot probably submitted. */
const SHEET_COLUMNS = [
  'Reference',
  'Placed (IST)',
  'Placed (UTC)',
  'Customer',
  'Mobile',
  'WhatsApp',
  'Email',
  'Address',
  'City',
  'State',
  'PIN code',
  'Deliver by',
  'Items',
  'Total',
  'Preorder',
  'Emailed',
  'Check',
];

function toSheetRow(order) {
  return [
    order.reference,
    toIst(order.created_at),
    order.created_at,
    order.full_name,
    order.mobile,
    `91${order.mobile}`,
    order.email || '',
    order.address,
    order.city,
    order.state,
    order.pincode,
    order.delivery_date,
    order.item_summary,
    order.total,
    order.has_preorder ? 'yes' : '',
    order.notified ? 'yes' : '',
    order.flagged ? 'review' : '',
  ];
}

/* Written out by shifting the clock rather than asking for a locale: a Worker
   has no time zone of its own, and "the time the customer pressed the button"
   is the thing the owner needs. UTC is kept alongside it so there is no doubt
   which is which if a row is ever compared against a server log. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function toIst(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

/* Totals stay numeric so Excel can add up a column; the rupee symbol and the
   thousands separators are what the owner sees in the storefront, not what a
   spreadsheet can calculate. */

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}
