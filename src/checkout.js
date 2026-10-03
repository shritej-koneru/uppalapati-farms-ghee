import { products, currency, readCart, writeCart, productImage, cartHasPreorder, cartStorageKey, PREORDER_NOTICE_DAYS } from './catalogue.js';
import { earliestDeliveryDate, latestDeliveryDate } from './pricing.js';

const checkoutContent = document.querySelector('[data-checkout-content]');
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

    showConfirmation(payload.mobile, result.reference);
  } catch {
    /* Network failure, or the shop is unreachable. The order was NOT recorded,
       so the confirmation is deliberately withheld — telling a customer their
       order is in when it is not would cost them the sale and us the trust. */
    checkoutStatus.textContent =
      'We could not reach the shop just now, so your order was not recorded. Please try again in a moment, or message us on WhatsApp.';
    checkoutSubmit.disabled = false;
  }
});

function showConfirmation(mobile, reference) {
  document.querySelector('[data-confirmation-number]').textContent = formatMobile(mobile);
  document.querySelector('[data-confirmation-reference]').textContent = reference || '—';
  checkoutForm.reset();
  /* Emptied only once the order is confirmed recorded. A customer who returns to
     the shop after a success would otherwise still be holding the jars they just
     ordered, and could easily place the same order twice. */
  writeCart({});
  checkoutContent.hidden = true;
  checkoutConfirmation.hidden = false;
  checkoutConfirmation.focus();
}

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
