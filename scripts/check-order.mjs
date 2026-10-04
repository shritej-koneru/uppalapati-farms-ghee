/* ---------- Order validation ----------

   `validateOrder` is the gate in front of the order book: whatever it refuses is
   an order that cannot be placed, and whatever it lets through is a row the owner
   has to act on. A false refusal costs a sale, so the awkward cases are the ones
   worth pinning down here rather than waiting to find out the hard way.

   Driven through `validateOrder` rather than testing the helper underneath, so
   the assertions are about what a customer submitting that form would actually
   get — which is the only version of this question that matters.

   The delivery window is computed relative to today, so the body below builds its
   date from the same clock the validator uses instead of hard-coding one that
   would start failing the day the booking horizon moved. */

import { validateOrder, isHoneypotFilled } from '../functions/_lib/orders.js';
import { earliestDeliveryDate, latestDeliveryDate, addDays } from '../src/pricing.js';

let failures = 0;
function check(ok, label) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

/* A body that is valid in every respect except whatever the case under test
   changes, so a failure points at one field rather than at the form. */
function bodyWith(overrides = {}) {
  return {
    requestKey: crypto.randomUUID(),
    cart: { 'one-litre': 1 },
    fullName: 'Priya Sharma',
    mobile: '9876543210',
    email: 'priya.sharma@gmail.com',
    address: '12/4 Gandhi St, Nr SBI',
    city: 'Guntur',
    state: 'Andhra Pradesh',
    pincode: '522001',
    deliveryDate: earliestDeliveryDate(false),
    ...overrides,
  };
}

const accepts = (overrides, expectedMobile) => {
  const result = validateOrder(bodyWith(overrides));
  const message = result.ok
    ? `accepted as ${result.order.mobile}`
    : `refused with ${JSON.stringify(result.errors)}`;
  check(result.ok && result.order.mobile === expectedMobile, `${JSON.stringify(overrides.mobile ?? 'default')} -> ${message}`);
};

/* ---------- The mobile number ----------

   Ten digits starting 6-9 is the whole of what WhatsApp can reach, and the form
   asks for exactly that. Everything below is a customer typing the same number a
   different way, or a number that genuinely begins 91. */

console.log('\nA number typed the ordinary way is accepted unchanged');
accepts({ mobile: '9876543210' }, '9876543210');
accepts({ mobile: '6000000000' }, '6000000000');
accepts({ mobile: '9999999999' }, '9999999999');

console.log('\nPunctuation and spacing a person adds while typing are forgiven');
accepts({ mobile: '98765 43210' }, '9876543210');
accepts({ mobile: '98765-43210' }, '9876543210');
accepts({ mobile: '(98765) 43210' }, '9876543210');

console.log('\nA number beginning 91 is a real number, not a country code to strip');
/* This is the one that was wrong. `91` is both a legal start for an Indian mobile
   and the prefix of every number typed in international form, so the old code
   stripped it unconditionally and handed eight digits back to the pattern, which
   refused a number WhatsApp could reach perfectly well. */
accepts({ mobile: '9198765432' }, '9198765432');
accepts({ mobile: '9123456780' }, '9123456780');
accepts({ mobile: '9988776655' }, '9988776655');

console.log('\nA number typed in international form still reduces to the local number');
accepts({ mobile: '+91 98765 43210' }, '9876543210');
accepts({ mobile: '919876543210' }, '9876543210');
accepts({ mobile: '00919876543210' }, '9876543210');
accepts({ mobile: '+91-98765-43210' }, '9876543210');

console.log('\nNumbers WhatsApp cannot reach are still refused');
for (const bad of [
  '5876543210', // starts 5 — not allocated to mobiles in India
  '587654321', // nine digits
  '98765432101', // eleven digits, and not a country code we recognise
  '+44 2079460958', // a UK number
  'abcdefghij',
  '',
  null,
]) {
  const result = validateOrder(bodyWith({ mobile: bad }));
  check(!result.ok && Boolean(result.errors?.mobile), `refuses ${JSON.stringify(bad)}`);
}

console.log('\nEvery other field is still checked');
for (const [field, value] of [
  ['fullName', 'A'],
  ['address', 'short'],
  ['city', ''],
  ['state', ''],
  ['pincode', '000001'],
  ['pincode', '52200'],
  ['email', 'not-an-email'],
]) {
  const result = validateOrder(bodyWith({ [field]: value }));
  check(!result.ok && Boolean(result.errors?.[field]), `refuses ${field} = ${JSON.stringify(value)}`);
}

console.log('\nThe preorder lead time moves the earliest date, and is enforced');
{
  /* Butter and curd are made to order, so a cart containing one cannot be
     delivered tomorrow however the date picker was set. */
  const withPreorder = validateOrder(
    bodyWith({ cart: { butter: 1 }, deliveryDate: earliestDeliveryDate(false) }),
  );
  check(
    !withPreorder.ok && Boolean(withPreorder.errors?.deliveryDate),
    `a preorder item due ${earliestDeliveryDate(false)} is refused: ${JSON.stringify(withPreorder.errors ?? withPreorder.order?.hasPreorder)}`,
  );

  const inTime = validateOrder(
    bodyWith({ cart: { butter: 1 }, deliveryDate: earliestDeliveryDate(true) }),
  );
  check(inTime.ok, `a preorder item due ${earliestDeliveryDate(true)} is accepted`);
}

console.log('\nThe booking horizon has an upper bound too');
{
  const last = latestDeliveryDate();
  check(validateOrder(bodyWith({ deliveryDate: last })).ok, `${last} — the last bookable day — is accepted`);

  const past = validateOrder(bodyWith({ deliveryDate: addDays(last, 1) }));
  check(!past.ok && Boolean(past.errors?.deliveryDate), `${addDays(last, 1)}, a day past the horizon, is refused`);

  const tomorrow = earliestDeliveryDate(false);
  const before = validateOrder(bodyWith({ deliveryDate: addDays(tomorrow, -1) }));
  check(!before.ok && Boolean(before.errors?.deliveryDate), `${addDays(tomorrow, -1)}, before the window opens, is refused`);
}

console.log('\nAn empty cart is not an order');
{
  const result = validateOrder(bodyWith({ cart: {} }));
  check(!result.ok && Boolean(result.errors?.cart), 'a cart with nothing in it is refused');
}

console.log('\nThe honeypot is recognised, and separately from validity');
{
  /* A bot fills in the hidden field. That must not make the order invalid — it is
     recorded instead, so the owner can see what arrived — but it must be
     detected, or the field is decoration. */
  check(isHoneypotFilled({ company: 'https://spam.example' }), 'a filled company field is a bot');
  check(isHoneypotFilled({ company: 'buy now' }), 'a filled company field is a bot');
  check(!isHoneypotFilled({ company: '' }), 'an empty company field is not a bot');
  check(!isHoneypotFilled({}), 'a missing company field is not a bot');

  const result = validateOrder(bodyWith({ company: 'https://spam.example' }));
  check(result.ok, 'a bot-filling order is still valid — it is flagged, not dropped');
}

console.log(failures === 0 ? '\nOrder validation holds.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);