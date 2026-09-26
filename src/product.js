import { products, currency } from './catalogue.js';
import { whatsappLink, productEnquiryMessage } from './business.js';

const frame = document.querySelector('[data-pdp-frame]');
const title = document.querySelector('[data-pdp-title]');
const eyebrow = document.querySelector('[data-pdp-eyebrow]');
const price = document.querySelector('[data-pdp-price]');
const summary = document.querySelector('[data-pdp-summary]');
const specs = document.querySelector('[data-pdp-specs]');
const thumbs = [...document.querySelectorAll('[data-pdp-thumb]')];
const addButton = document.querySelector('[data-pdp-add]');
const enquireLink = document.querySelector('[data-pdp-enquire]');
const switcher = [...document.querySelectorAll('[data-pdp-switch]')];

const params = new URLSearchParams(window.location.search);
const requested = params.get('size');
let activeKey = requested && requested in products ? requested : 'one-litre';

const gallery = ['/media/ghee-frame-02.jpg', '/media/ghee-frame-05.jpg', '/media/ghee-frame-08.jpg'];

function renderProduct() {
  const product = products[activeKey];

  document.title = `${product.name} ${product.size} — Uppalapati Farms`;
  eyebrow.textContent = product.label;
  title.textContent = `${product.name} · ${product.size}`;
  price.innerHTML = `${currency.format(product.price)} <span>incl. of all taxes</span>`;
  summary.textContent = product.summary;

  frame.innerHTML = `<img src="${product.image}" alt="${product.name} in a ${product.size} jar" />`;

  // The frame now shows the product hero, not a gallery shot, so no
  // thumbnail should claim to be the active one.
  thumbs.forEach((thumb) => thumb.classList.remove('is-active'));

  specs.innerHTML = product.specs
    .map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`)
    .join('');

  addButton.dataset.addProduct = activeKey;
  enquireLink.href = whatsappLink(productEnquiryMessage(activeKey));

  switcher.forEach((link) => {
    const isActive = link.dataset.pdpSwitch === activeKey;
    link.setAttribute('aria-current', isActive ? 'true' : 'false');
    link.classList.toggle('is-active', isActive);
  });
}

thumbs.forEach((thumb, index) => {
  thumb.addEventListener('click', () => {
    frame.innerHTML = `<img src="${gallery[index]}" alt="Uppalapati Farms — gallery view" />`;
    thumbs.forEach((other) => other.classList.remove('is-active'));
    thumb.classList.add('is-active');
  });
});

switcher.forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    const next = link.dataset.pdpSwitch;
    if (!(next in products) || next === activeKey) return;
    activeKey = next;
    window.history.replaceState({}, '', `/product.html?size=${next}`);
    renderProduct();
  });
});

renderProduct();
