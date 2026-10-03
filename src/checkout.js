import { products, currency, readCart, productArt, cartHasPreorder, PREORDER_NOTICE_DAYS } from './catalogue.js';

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

function getCartEntries(cart) {
  return Object.entries(cart).filter(([key, quantity]) => quantity > 0 && key in products);
}

function getCartTotal(cart) {
  return getCartEntries(cart).reduce((total, [key, quantity]) => total + products[key].price * quantity, 0);
}

function renderCheckout() {
  const cart = readCart();
  const entries = getCartEntries(cart);
  checkoutItems.innerHTML = entries.map(([key, quantity]) => {
    const product = products[key];
    return `<article class="checkout-summary__item">
      <img src="${productArt(key)}" alt="" />
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
}

checkoutForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (getCartEntries(readCart()).length === 0) return;
  if (!checkoutForm.reportValidity()) {
    checkoutStatus.textContent = 'Please complete the required fields with valid details.';
    checkoutForm.querySelector(':invalid')?.focus();
    return;
  }
  const formData = new window.FormData(checkoutForm);
  const name = String(formData.get('fullName') || '').trim();
  checkoutForm.reset();
  checkoutStatus.textContent = name ? `Thanks, ${name}. Your test order is noted.` : 'Your test order is noted.';
  checkoutContent.hidden = true;
  checkoutConfirmation.hidden = false;
  checkoutConfirmation.focus();
});

renderCheckout();
