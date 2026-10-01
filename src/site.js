import { readCart, cartCount, addCartItem, products, cartStorageKey } from './catalogue.js';
import { business, registration, whatsappLink, generalEnquiryMessage, cartEnquiryMessage } from './business.js';

const header = document.querySelector('[data-site-header]');
const menuButton = document.querySelector('[data-menu-toggle]');
const navList = document.querySelector('[data-site-nav]');
const cartBadges = [...document.querySelectorAll('[data-cart-badge]')];
const cartLinks = [...document.querySelectorAll('[data-cart-link]')];
const cartWhatsApp = [...document.querySelectorAll('[data-cart-whatsapp]')];
const yearSlots = [...document.querySelectorAll('[data-year]')];
const whatsappSlots = [...document.querySelectorAll('[data-whatsapp-link]')];
const addButtons = [...document.querySelectorAll('[data-add-product]')];

let cart = readCart();

function renderCart() {
  const count = cartCount(cart);
  cartBadges.forEach((badge) => {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  });
  cartLinks.forEach((link) => {
    link.setAttribute('aria-label', count === 0 ? 'Cart is empty' : `Cart, ${count} ${count === 1 ? 'item' : 'items'}`);
  });
  cartWhatsApp.forEach((link) => {
    link.href = whatsappLink(cartEnquiryMessage(cart));
    link.target = '_blank';
    link.rel = 'noopener';
  });
}

function closeMenu() {
  document.body.classList.remove('menu-open');
  if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
}

function toggleMenu() {
  const open = document.body.classList.toggle('menu-open');
  menuButton?.setAttribute('aria-expanded', String(open));
}

if (menuButton && navList) {
  menuButton.addEventListener('click', toggleMenu);
  navList.addEventListener('click', (event) => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.matchMedia('(min-width: 860px)').addEventListener('change', (event) => {
    if (event.matches) closeMenu();
  });
}

/* The home hero owns the top of the viewport, so the bar waits until
   the visitor has scrolled into the film before it appears. */
function syncHeaderVisibility() {
  if (!header) return;
  const overlay = header.dataset.headerOverlay === 'true';
  if (!overlay) {
    header.classList.add('is-header-visible');
    return;
  }
  header.classList.toggle('is-header-visible', window.scrollY > window.innerHeight * 0.55);
}

window.addEventListener('scroll', syncHeaderVisibility, { passive: true });
window.addEventListener('resize', syncHeaderVisibility, { passive: true });
syncHeaderVisibility();

yearSlots.forEach((slot) => {
  slot.textContent = String(new Date().getFullYear());
});

const businessFields = {
  'business-phone': business.phoneDisplay,
  'business-email': business.email,
  'business-address': business.address,
  'business-hours': business.hours,
  'business-fssai': business.fssai,
  'licence-number': registration.displayNumber,
  'licence-holder': registration.holder,
  'licence-premises': registration.premises,
  'licence-kind': registration.kindOfBusiness,
  'licence-authority': registration.registeringAuthority,
  'licence-issued': registration.issuedOn,
  'licence-valid': registration.feePaidUpto,
  'licence-status': registration.status,
  'licence-turnover': registration.turnoverCap,
  'licence-fee': registration.annualFee,
  'licence-suspension': registration.suspension,
  'licence-helpline': registration.helpline,
  'licence-authority-state': registration.authority,
};

const businessLinks = {
  'business-email': `mailto:${business.email}`,
  'business-phone': `tel:+${business.whatsappNumber}`,
  'licence-helpline': 'tel:1800112100',
};

Object.entries(businessFields).forEach(([key, value]) => {
  document.querySelectorAll(`[data-${key}]`).forEach((slot) => {
    slot.textContent = value;
    const href = businessLinks[key];
    if (href && slot instanceof HTMLAnchorElement) slot.href = href;
  });
});

whatsappSlots.forEach((link) => {
  const message = link.dataset.whatsappMessage || generalEnquiryMessage();
  link.href = whatsappLink(message);
  link.target = '_blank';
  link.rel = 'noopener';
});

/* The home page owns its own cart wiring, so binding is opt-in. */
if (document.body.dataset.siteCart === 'true') {
  addButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.addProduct;
      if (!(key in products)) return;
      cart = addCartItem(cart, key, 1);
      renderCart();
      button.classList.add('is-in-cart');
      button.textContent = 'Added ✓';
      window.setTimeout(() => {
        button.textContent = 'Add to cart';
      }, 1600);
    });
  });
}

window.addEventListener('cart:updated', () => {
  cart = readCart();
  renderCart();
});

window.addEventListener('storage', (event) => {
  if (event.key !== cartStorageKey) return;
  cart = readCart();
  renderCart();
});

document.addEventListener('visibilitychange', syncHeaderVisibility);

renderCart();
