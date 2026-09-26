import { bottleArt } from './bottles.js';

const checkoutContent = document.querySelector('[data-checkout-content]');
const checkoutDetails = document.querySelector('[data-checkout-details]');
const checkoutItems = document.querySelector('[data-checkout-items]');
const checkoutEmpty = document.querySelector('[data-checkout-empty]');
const checkoutTotal = document.querySelector('[data-checkout-total]');
const checkoutForm = document.querySelector('[data-checkout-form]');
const checkoutSubmit = document.querySelector('[data-checkout-submit]');
const checkoutStatus = document.querySelector('[data-checkout-status]');
const checkoutConfirmation = document.querySelector('[data-checkout-confirmation]');
const cartStorageKey = 'uppalapati-farms-cart';
const products = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 699,
    image: `data:image/svg+xml,${encodeURIComponent(bottleArt('half-litre', 'bottle-500'))}`,
  },
  'one-litre': {
    name: 'One-litre ghee',
    size: '1 L',
    price: 1299,
    image: `data:image/svg+xml,${encodeURIComponent(bottleArt('one-litre', 'bottle-1000'))}`,
  },
};
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function loadCart() {
  const emptyCart = { 'half-litre': 0, 'one-litre': 0 };
  try {
    const savedCart = JSON.parse(window.localStorage.getItem(cartStorageKey));
    if (!savedCart || typeof savedCart !== 'object') return emptyCart;
    return {
      'half-litre': clamp(Math.trunc(Number(savedCart['half-litre'])) || 0, 0, 9),
      'one-litre': clamp(Math.trunc(Number(savedCart['one-litre'])) || 0, 0, 9),
    };
  } catch {
    return emptyCart;
  }
}

function getCartEntries(cart) {
  return Object.entries(cart).filter(([, quantity]) => quantity > 0);
}

function getCartTotal(cart) {
  return getCartEntries(cart).reduce((total, [key, quantity]) => total + products[key].price * quantity, 0);
}

function renderCheckout() {
  const cart = loadCart();
  const entries = getCartEntries(cart);
  checkoutItems.innerHTML = entries.map(([key, quantity]) => {
    const product = products[key];
    return `<article class="checkout-summary__item">
      <img src="${product.image}" alt="" />
      <div>
        <p>${product.size}</p>
        <h2>${product.name}</h2>
        <span>${currency.format(product.price)} each</span>
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
}

checkoutForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (getCartEntries(loadCart()).length === 0) return;
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
