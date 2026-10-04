import { products, currency, readCart, writeCart, productImage, cartHasPreorder, cartStorageKey, PREORDER_NOTICE_DAYS } from './catalogue.js';
import { earliestDeliveryDate, latestDeliveryDate } from './pricing.js';
import { barcodeSvg } from './barcode.js';

const checkoutDetails = document.querySelector('[data-checkout-details]');
const checkoutItems = document.querySelector('[data-checkout-items]');
const checkoutEmpty = document.querySelector('[data-checkout-empty]');
const checkoutTotal = document.querySelector('[data-checkout-total]');
const checkoutForm = document.querySelector('[data-checkout-form]');
const checkoutSubmit = document.querySelector('[data-checkout-submit]');
const checkoutStatus = document.querySelector('[data-checkout-status]');
const checkoutConfirmation = document.querySelector('[data-checkout-confirmation]');
const checkoutLead = document.querySelector('[data-checkout-lead]');
const deliveryDate = document.querySelector('#delivery-date');
const deliveryHint = document.querySelector('[data-delivery-hint]');

function getCartEntries(cart) {
  return Object.entries(cart).filter(([key, quantity]) => quantity > 0 && key in products);
}

function getCartTotal(cart) {
  return getCartEntries(cart).reduce((total, [key, quantity]) => total + products[key].price * quantity, 0);
}

/* "9876543210" -> "+91 98765 43210". Shown back to the customer on the
   confirmation so they can see exactly which number we will message, which is
   the one thing they cannot check once the form is gone. */
function formatMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return value;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/* The date picker's bounds come from the same rules the server checks, so the
   browser never offers a date that will then be refused. Re-run whenever the
   cart changes, because a preorder item moves the earliest date two days out. */
function syncDeliveryWindow() {
  const needsLead = cartHasPreorder(readCart());
  const earliest = earliestDeliveryDate(needsLead);
  const latest = latestDeliveryDate();
  deliveryDate.min = earliest;
  deliveryDate.max = latest;

  deliveryHint.textContent = needsLead
    ? `Earliest ${earliest} — butter and curd are made to order and need ${PREORDER_NOTICE_DAYS} days notice.`
    : `Earliest ${earliest}. We will confirm the exact day with you on WhatsApp.`;

  /* If the cart gains a preorder item after a date was chosen, that date may no
     longer be possible. Nudging it forward is friendlier than letting the
     customer submit and be refused. */
  if (deliveryDate.value && deliveryDate.value < earliest) deliveryDate.value = earliest;
}

function renderCheckout() {
  const cart = readCart();
  const entries = getCartEntries(cart);
  checkoutItems.innerHTML = entries.map(([key, quantity]) => {
    const product = products[key];
    return `<article class="checkout-summary__item">
      <img src="${productImage(key)}" alt="" />
      <div>
        <p>${product.size}</p>
        <h2>${product.name}</h2>
        <span>${currency.format(product.price)} each</span>
        ${product.preorder ? `<span class="checkout-summary__preorder">Preorder · ${PREORDER_NOTICE_DAYS} days notice</span>` : ''}
      </div>
      <span class="checkout-summary__quantity">×${quantity}</span>
    </article>`;
  }).join('');
  const isEmpty = entries.length === 0;
  checkoutEmpty.hidden = !isEmpty;
  checkoutTotal.textContent = currency.format(getCartTotal(cart));
  checkoutDetails.hidden = isEmpty;
  checkoutForm.hidden = isEmpty;
  checkoutSubmit.disabled = isEmpty;

  // Only warn about the lead time when the cart actually contains an item
  // that needs it, so ready-stock orders are not delayed by this copy.
  const needsLead = !isEmpty && cartHasPreorder(cart);
  checkoutLead.hidden = !needsLead;
  if (needsLead) {
    checkoutLead.textContent = `Your cart includes a preorder item. Please allow ${PREORDER_NOTICE_DAYS} days before dispatch.`;
  }

  syncDeliveryWindow();
}

/* One key per checkout attempt, reused if the request has to be retried, so a
   dropped connection cannot create the same order twice. */
const requestKey = crypto.randomUUID();

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const cart = readCart();
  if (getCartEntries(cart).length === 0) return;

  checkoutStatus.textContent = '';
  clearFieldErrors();

  if (!checkoutForm.reportValidity()) {
    checkoutStatus.textContent = 'Please complete the required fields with valid details.';
    checkoutForm.querySelector(':invalid')?.focus();
    return;
  }

  const formData = new window.FormData(checkoutForm);
  const payload = {
    requestKey,
    cart: Object.fromEntries(getCartEntries(cart)),
    fullName: formData.get('fullName'),
    mobile: formData.get('mobile'),
    email: formData.get('email'),
    address: formData.get('address'),
    city: formData.get('city'),
    state: formData.get('state'),
    pincode: formData.get('pincode'),
    deliveryDate: formData.get('deliveryDate'),
    company: formData.get('company'),
  };

  checkoutSubmit.disabled = true;
  checkoutStatus.textContent = 'Recording your order…';

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);

    if (!response.ok || !result?.ok) {
      /* Field errors from the server are put next to the input they belong to.
         The date is re-checked here because the server may be refusing it for a
         reason the browser does not know about. */
      if (result?.errors) applyFieldErrors(result.errors);
      checkoutStatus.textContent =
        result?.errors?._form ??
        'We could not record that order. Please check the highlighted fields and try again.';
      if (result?.errors?.deliveryDate) syncDeliveryWindow();
      checkoutSubmit.disabled = false;
      checkoutForm.querySelector(':invalid')?.focus();
      return;
    }

    /* The receipt quotes what the server recorded — including the amount, which
       is why the response carries it rather than the page recomputing a figure the
       order book may disagree with. On a repeat of a request already stored this
       is the original order, so a double-tap cannot hand out a second ticket with
       a different total. */
    showConfirmation({
      mobile: payload.mobile,
      reference: result.reference,
      total: result.total,
      createdAt: result.createdAt,
    });
  } catch {
    /* Network failure, or the shop is unreachable. The order was NOT recorded,
       so the confirmation is deliberately withheld — telling a customer their
       order is in when it is not would cost them the sale and us the trust. */
    checkoutStatus.textContent =
      'We could not reach the shop just now, so your order was not recorded. Please try again in a moment, or message us on WhatsApp.';
    checkoutSubmit.disabled = false;
  }
});

/* ---------- The receipt ----------

   A native <dialog> rather than a div with a class. Everything a modal has to
   get right — trapping focus inside it, making the rest of the page inert,
   Escape to dismiss, stacking above the header — is behaviour the browser
   already implements correctly, and every one of those is a thing hand-rolled
   modals get subtly wrong. */

const receiptPrint = document.querySelector('[data-confirmation-print]');
const receiptClose = document.querySelector('[data-confirmation-close]');
const receiptConfetti = document.querySelector('[data-receipt-confetti]');

/* The date and time the order was placed, in the farm's own timezone.

   Shifted rather than formatted with a locale: the browser may carry a different
   set of ICU data from the server, and a locale-formatted date and time is exactly
   the kind of thing that comes out as "04/10/2026, 4:41 pm" on one machine and
   "10/4/2026, 16:41" on the next. Twelve-hour clock dropped as well — a receipt
   read out over the phone is easier without it. The same +5:30 the server numbers
   the reference by, so the date here and the day in the reference cannot disagree.

   Duplicated from functions/_lib/orders.js on purpose. This one is for the
   customer's eye and that one is for the order book; importing a Worker module
   into a page that also has to work from a plain static build is not worth the
   coupling, and both are a single named constant either way. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function formatPlacedAt(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const ist = new Date(parsed.getTime() + IST_OFFSET_MS);
  const day = String(ist.getUTCDate()).padStart(2, '0');
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const hours = String(ist.getUTCHours()).padStart(2, '0');
  const minutes = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${ist.getUTCFullYear()} • ${hours}:${minutes}`;
}

/* One short burst of confetti, then nothing.

   The pieces are built once and removed when they have fallen, rather than being
   re-randomised per frame — the component this came from called `Math.random()`
   inside its render, which slid every piece to a new place whenever anything
   re-rendered, and rebuilt all hundred on every state change. */
const CONFETTI_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#8b5cf6', '#f97316'];
const CONFETTI_COUNT = 100;

function celebrate() {
  if (!receiptConfetti) return;
  /* The CSS drops this element entirely under `prefers-reduced-motion`, so there
     is nothing to build. */
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const pieces = document.createDocumentFragment();
  let latest = 0;

  for (let i = 0; i < CONFETTI_COUNT; i += 1) {
    const piece = document.createElement('i');
    const duration = 2.5 + Math.random() * 2.5;
    const delay = Math.random() * 2;
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.top = `${-20 + Math.random() * 10}%`;
    piece.style.backgroundColor = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;
    pieces.appendChild(piece);
    latest = Math.max(latest, delay + duration);
  }

  receiptConfetti.appendChild(pieces);
  window.setTimeout(() => receiptConfetti.replaceChildren(), latest * 1000 + 250);
}

function showConfirmation({ mobile, reference, total, createdAt }) {
  const safeReference = reference || '—';

  document.querySelector('[data-confirmation-number]').textContent = formatMobile(mobile);
  document.querySelector('[data-confirmation-reference]').textContent = safeReference;
  document.querySelector('[data-confirmation-amount]').textContent =
    Number.isFinite(Number(total)) ? currency.format(Number(total)) : '—';
  document.querySelector('[data-confirmation-placed]').textContent =
    formatPlacedAt(createdAt) || '—';

  /* The barcode is drawn from the same string printed beside it, never from
     anything the page already had. If the value cannot be encoded the container
     is emptied rather than left holding a previous order's bars. */
  document.querySelector('[data-confirmation-barcode-text]').textContent = safeReference;
  document.querySelector('[data-confirmation-barcode]').innerHTML = barcodeSvg(safeReference);

  checkoutForm.reset();
  /* Emptied only once the order is confirmed recorded. A customer who returns to
     the shop after a success would otherwise still be holding the jars they just
     ordered, and could easily place the same order twice. */
  writeCart({});
  renderCheckout();

  if (typeof checkoutConfirmation.showModal === 'function') {
    checkoutConfirmation.showModal();
    /* Focused on the card rather than on the first button: the order number is
       the thing worth reading out, and `aria-labelledby` announces the heading
       as focus lands here. Tab still reaches the buttons next. */
    checkoutConfirmation.focus();
  } else {
    /* No <dialog> support at all, which means no browser this shop has customers
       on. Showing the receipt as an ordinary block still puts the number and the
       number to message in front of them, which is the part that must not be
       lost. */
    checkoutConfirmation.setAttribute('open', '');
  }

  celebrate();
}

receiptPrint?.addEventListener('click', () => window.print());

receiptClose?.addEventListener('click', () => checkoutConfirmation.close());

/* On close, put the keyboard somewhere sensible. The form the customer was
   filling in is gone — the cart is empty now — so focus goes to the empty-cart
   message's link back to the shop rather than back to a submit button that no
   longer exists, which is where the browser's default would leave it. */
checkoutConfirmation.addEventListener('close', () => {
  document.querySelector('.checkout-back')?.focus();
});

function applyFieldErrors(errors) {
  Object.entries(errors).forEach(([field, message]) => {
    const input = checkoutForm.querySelector(`[name="${field}"]`);
    if (!input) return;
    input.setAttribute('aria-invalid', 'true');
    const note = document.createElement('p');
    note.className = 'checkout-form__error';
    note.textContent = message;
    input.insertAdjacentElement('afterend', note);
  });
}

function clearFieldErrors() {
  checkoutForm.querySelectorAll('[aria-invalid="true"]').forEach((input) => input.removeAttribute('aria-invalid'));
  checkoutForm.querySelectorAll('.checkout-form__error').forEach((note) => note.remove());
}

/* A cart edited in another tab should not leave a stale total or an impossible
   date behind. */
window.addEventListener('storage', (event) => {
  if (event.key === cartStorageKey) renderCheckout();
});

renderCheckout();
