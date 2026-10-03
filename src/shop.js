import {
  products,
  productKeys,
  currency,
  productArt,
  packFor,
  packTotalGrams,
  packTotalPrice,
  formatWeight,
  readCart,
  addCartItem,
  cartHasPreorder,
  PREORDER_NOTICE_DAYS,
} from './catalogue.js';
import { whatsappLink, productEnquiryMessage } from './business.js';

/* The shop shows every product at once.

   The page used to be a single product with four small links to swap between
   them. That worked for two ghee jars and stopped working the moment butter and
   curd were added: the links read as filters rather than as products, so
   nothing on the page told a visitor that butter and curd existed. Everything
   here is rendered from the catalogue, so adding a fifth product is a catalogue
   edit and nothing else. */

const grid = document.querySelector('[data-shop-grid]');
const leadNotice = document.querySelector('[data-shop-lead]');
const daysSlots = [...document.querySelectorAll('[data-preorder-days]')];

const gallery = ['/media/ghee-frame-02.jpg', '/media/ghee-frame-05.jpg', '/media/ghee-frame-08.jpg'];

const MIN_BLOCKS = 1;
const MAX_BLOCKS = 9;

/* Per-card stepper state. Only weight-sold products ever read this. */
const blockCounts = {};

const params = new URLSearchParams(window.location.search);
const requested = params.get('size');

/* Deep links such as /product.html?size=butter still work. They now pick which
   card starts open rather than navigating to a single-product page, so the six
   footers across the site that point at them keep working unchanged. */
let openKey = requested && requested in products ? requested : productKeys[0];

/* Set when the user's click should move focus, so the re-render can put it back.
   Never set on first paint, which would steal focus from the top of the page. */
let pendingFocusKey = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
  });
}

function blockCountFor(key) {
  return blockCounts[key] ?? MIN_BLOCKS;
}

/* ---------- Pricing ---------- */

function unitPrice(key, blocks = blockCountFor(key)) {
  // Ghee has no stepper, so its block count is meaningless: it is always one
  // jar. Stated here rather than left to rely on the stepper defaulting to 1.
  return packTotalPrice(key, packFor(key) ? blocks : 1);
}

function linePriceText(key) {
  return currency.format(unitPrice(key));
}

/* Both figures a shopper needs: the price, and what one of them weighs. The
   card does not print a per-kilo rate. Once the block prices moved to 1,799 and
   249, any rate derived from them came out as odd numbers like 3,598/kg that
   invited the question the rate was meant to answer. */
function unitLine(key) {
  const pack = packFor(key);
  if (!pack) return 'incl. of all taxes';
  return `${formatWeight(pack.grams)} each`;
}

function readoutText(key, blocks) {
  const grams = packTotalGrams(key, blocks);
  const total = packTotalPrice(key, blocks);
  return `${blocks} × ${packFor(key).packLabel} — ${formatWeight(grams)}, ${currency.format(total)}`;
}

/* ---------- Card markup ---------- */

function artMarkup(key) {
  const product = products[key];
  // Prefer a real photograph. Butter and curd have none yet, so they fall back
  // to the drawn art rather than borrowing the ghee jar's photo.
  const isDrawn = !product.image;
  const source = product.image || productArt(key);
  const alt = `${product.name} in a ${product.size} ${isDrawn ? 'tub' : 'jar'}`;
  return `<img class="${isDrawn ? 'shop-card__drawn' : ''}" src="${source}" alt="${escapeHtml(alt)}" loading="lazy" />`;
}

function stepperMarkup(key) {
  const pack = packFor(key);
  if (!pack) return '';
  const blocks = blockCountFor(key);
  return `<div class="shop-stepper">
        <p class="shop-stepper__label" id="qty-label-${key}">Quantity <span>(${escapeHtml(pack.packLabel)} each)</span></p>
        <div class="shop-stepper__row">
          <button class="shop-stepper__btn" type="button" data-step="${key}:-1" aria-label="One fewer ${escapeHtml(pack.packLabel)}"${blocks <= MIN_BLOCKS ? ' disabled' : ''}>&minus;</button>
          <output class="shop-stepper__value" data-step-value="${key}" aria-labelledby="qty-label-${key}">${blocks}</output>
          <button class="shop-stepper__btn" type="button" data-step="${key}:1" aria-label="One more ${escapeHtml(pack.packLabel)}"${blocks >= MAX_BLOCKS ? ' disabled' : ''}>+</button>
        </div>
        <p class="shop-stepper__readout" data-step-readout="${key}">${escapeHtml(readoutText(key, blocks))}</p>
      </div>`;
}

function galleryMarkup(key) {
  const product = products[key];
  return `<div class="shop-card__gallery">
        ${gallery
          .map(
            (src, index) =>
              `<img src="${src}" alt="Uppalapati Farms ${escapeHtml(product.name)}, view ${index + 1}" loading="lazy" />`,
          )
          .join('')}
      </div>`;
}

function cardMarkup(key) {
  const product = products[key];
  const isOpen = key === openKey;

  return `<article class="shop-card${isOpen ? ' is-open' : ''}" data-shop-card="${key}">
        <button class="shop-card__head" type="button" data-card-toggle="${key}" aria-expanded="${isOpen}" aria-controls="shop-panel-${key}">
          <span class="shop-card__art">${artMarkup(key)}</span>
          <span class="shop-card__ident">
            <span class="shop-card__label">${escapeHtml(product.label)}</span>
            <span class="shop-card__name">${escapeHtml(product.name)}</span>
            <span class="shop-card__size">${escapeHtml(product.size)}</span>
          </span>
          <span class="shop-card__pricing">
            <span class="shop-card__price" data-card-price="${key}">${escapeHtml(linePriceText(key))}</span>
            <span class="shop-card__unit">${escapeHtml(unitLine(key))}</span>
          </span>
          <span class="shop-card__chevron" aria-hidden="true"></span>
        </button>

        ${product.preorder ? `<p class="shop-card__flag">Preorder · ${PREORDER_NOTICE_DAYS} days notice</p>` : ''}

        <div class="shop-card__panel" id="shop-panel-${key}" data-card-panel="${key}"${isOpen ? '' : ' hidden'}>
          <p class="shop-card__summary">${escapeHtml(product.summary)}</p>
          ${stepperMarkup(key)}
          <dl class="spec-list shop-card__specs">
            ${product.specs.map(([term, detail]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(detail)}</dd></div>`).join('')}
          </dl>
          <div class="shop-card__actions">
            <button class="checkout-button" type="button" data-card-add="${key}">Add to cart</button>
            <a class="text-link" href="${whatsappLink(productEnquiryMessage(key))}" target="_blank" rel="noopener" data-card-enquire="${key}">Enquire on WhatsApp</a>
          </div>
          ${
            product.preorder
              ? `<p class="shop-card__preorder">${escapeHtml(product.name)} is made on the days we churn. Please allow ${PREORDER_NOTICE_DAYS} days before the date you need it.</p>`
              : ''
          }
          ${isOpen ? galleryMarkup(key) : ''}
        </div>
      </article>`;
}

/* ---------- Rendering ---------- */

function render() {
  if (!grid) return;
  grid.innerHTML = productKeys.map(cardMarkup).join('');
  if (pendingFocusKey) {
    grid.querySelector(`[data-card-toggle="${pendingFocusKey}"]`)?.focus({ preventScroll: true });
    pendingFocusKey = null;
  }
  syncCartButtons();
}

function setOpen(key, { moveFocus = false } = {}) {
  if (!(key in products)) return;
  openKey = key;
  if (moveFocus) pendingFocusKey = key;
  render();
}

/* The stepper updates in place instead of re-rendering the grid, so the button
   the user just pressed keeps focus and the page does not jump. */
function updateBlockCount(key, delta) {
  if (!packFor(key)) return;
  const current = blockCountFor(key);
  const next = Math.min(Math.max(current + delta, MIN_BLOCKS), MAX_BLOCKS);
  if (next === current) return;
  blockCounts[key] = next;

  const blocks = blockCountFor(key);
  const value = grid.querySelector(`[data-step-value="${key}"]`);
  const readout = grid.querySelector(`[data-step-readout="${key}"]`);
  const price = grid.querySelector(`[data-card-price="${key}"]`);
  const enquire = grid.querySelector(`[data-card-enquire="${key}"]`);
  const minus = grid.querySelector(`[data-step="${key}:-1"]`);
  const plus = grid.querySelector(`[data-step="${key}:1"]`);

  if (value) value.textContent = String(blocks);
  if (readout) readout.textContent = readoutText(key, blocks);
  if (price) price.textContent = linePriceText(key);
  if (enquire) enquire.href = whatsappLink(productEnquiryMessage(key));
  // Both ends stop here, so the buttons show the limit rather than sitting
  // there doing nothing.
  if (minus) minus.disabled = blocks <= MIN_BLOCKS;
  if (plus) plus.disabled = blocks >= MAX_BLOCKS;
}

/* ---------- Cart ---------- */

function addToCart(key) {
  const blocks = packFor(key) ? blockCountFor(key) : 1;
  // Adds by the stepper's amount rather than setting an absolute count, so a
  // customer who taps add twice for one pack gets two.
  addCartItem(readCart(), key, blocks);

  const button = grid.querySelector(`[data-card-add="${key}"]`);
  if (button) {
    const restore = button.dataset.addLabel || button.textContent;
    button.dataset.addLabel = restore;
    button.classList.add('is-in-cart');
    button.textContent = blocks > 1 ? `Added ${blocks} ✓` : 'Added ✓';
    window.setTimeout(() => {
      button.textContent = button.dataset.addLabel || restore;
      button.classList.remove('is-in-cart');
    }, 1600);
  }

  // site.js owns the badge and the WhatsApp order link, so tell it the cart
  // moved rather than writing the DOM it owns from here.
  window.dispatchEvent(new CustomEvent('cart:updated'));
}

/* Shows what is already in the cart, so a customer who navigates away and back
   can see they did not lose a selection. */
function syncCartButtons() {
  const cart = readCart();
  grid.querySelectorAll('[data-card-add]').forEach((button) => {
    const key = button.dataset.cardAdd;
    const inCart = cart[key] ?? 0;
    button.dataset.inCart = String(inCart);
    if (!inCart) {
      button.textContent = button.dataset.addLabel || 'Add to cart';
      button.classList.remove('is-in-cart');
    } else if (!button.classList.contains('is-in-cart')) {
      button.textContent = `In cart (${inCart})`;
    }
  });
}

function syncLeadNotice() {
  if (!leadNotice) return;
  const show = cartHasPreorder(readCart());
  leadNotice.hidden = !show;
  if (show) {
    leadNotice.textContent = `Your cart includes a preorder item. Please allow ${PREORDER_NOTICE_DAYS} days before dispatch.`;
  }
}

/* ---------- Events ---------- */

if (grid) {
  grid.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-card-toggle]');
    if (toggle) {
      const key = toggle.dataset.cardToggle;
      // Tapping the open card closes it, which is what a disclosure is expected
      // to do. One card always stays open so the page never looks empty.
      if (openKey === key) {
        const next = productKeys.find((candidate) => candidate !== key) || key;
        setOpen(next, { moveFocus: true });
      } else {
        setOpen(key, { moveFocus: true });
      }
      return;
    }

    const step = event.target.closest('[data-step]');
    if (step) {
      const [key, delta] = step.dataset.step.split(':');
      updateBlockCount(key, Number(delta));
      return;
    }

    const add = event.target.closest('[data-card-add]');
    if (add) addToCart(add.dataset.cardAdd);
  });
}

window.addEventListener('cart:updated', () => {
  syncLeadNotice();
  syncCartButtons();
});

daysSlots.forEach((slot) => {
  slot.textContent = PREORDER_NOTICE_DAYS === 2 ? 'two' : String(PREORDER_NOTICE_DAYS);
});

render();
syncLeadNotice();
