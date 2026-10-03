import { bottleArt } from './bottles.js';

export const cartStorageKey = 'uppalapati-farms-cart';

/* Butter and curd are made in the same churn as the ghee, in the same
   quantities, so neither can be held ready-made. Both are preorder-only and
   need two days notice. `preorder` is what the UI, cart and checkout read to
   show that, so it lives here rather than being repeated per screen. */
export const PREORDER_NOTICE_DAYS = 2;

/* `pack` marks a product sold by weight rather than by jar, so the shop can show
   a quantity stepper and work out the total weight. It carries the pack size
   and nothing about money.

   There is deliberately no second price here. `pack.packPrice` duplicated
   `product.price`, and the cart read one while the shop read the other, so
   changing a price in one place could leave the two quietly disagreeing. Every
   figure now comes from `product.price`. */

/* Every product photograph in `image` is delivered as a 4:5 canvas, matching
   the shop card's art box. The source photos were not all 4:5, so each one was
   padded out to the ratio by repeating its own outermost row and column rather
   than by cropping it or letterboxing it against a flat colour: the studio
   backdrop runs to the edge of each frame but differs between them, so any
   shared fill colour would have shown as bars. Nothing is cropped, so a jar
   can never lose its lid, and one ratio keeps the four cards the same height.
   A new photo needs the same treatment before it is dropped in here. */
export const products = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 1999,
    image: '/media/ghee-half-litre.jpg',
    art: 'bottle-500',
    label: 'Everyday jar',
    summary:
      'Our everyday jar for households that cook with ghee daily. Slow-churned from farm-fresh milk in small batches, then sealed the same week so it arrives with that warm, nutty aroma intact.',
    specs: [
      ['Net weight', '500 ml'],
      ['Method', 'Bilona, hand-churned'],
      ['Shelf life', '9 months, unopened'],
      ['Storage', 'Keep away from direct sunlight'],
    ],
  },
  'one-litre': {
    name: 'One-litre ghee',
    size: '1 L',
    price: 3999,
    image: '/media/ghee-1litre.jpg',
    art: 'bottle-1000',
    label: 'Family pack',
    summary:
      'Our most loved jar. A full litre of traditional ghee, churned in a single slow batch and packed in food-grade glass so you can see exactly what you are cooking with.',
    specs: [
      ['Net weight', '1 litre'],
      ['Method', 'Bilona, hand-churned'],
      ['Shelf life', '9 months, unopened'],
      ['Storage', 'Keep away from direct sunlight'],
    ],
  },
  butter: {
    name: 'Cultured butter',
    size: '500 g',
    price: 1799,
    image: '/media/butter-500g.jpg',
    /* `art` stays as the fallback for a product whose photo ever goes missing;
       the shop and cart both prefer `image` whenever it is set. */
    art: 'butter-500',
    label: 'Preorder',
    preorder: true,
    pack: { grams: 500, packLabel: '500 g block' },
    summary:
      'The butter that rises to the top of our churn before the ghee is drawn off, hand-collected and packed the same morning. Made in the same small quantities as the ghee, so it is never held in reserve.',
    specs: [
      ['Net weight', '500 g'],
      ['Method', 'Bilona, hand-churned'],
      ['Availability', `Preorder, ${PREORDER_NOTICE_DAYS} days notice`],
      ['Storage', 'Refrigerate below 5°C'],
    ],
  },
  curd: {
    name: 'Set curd',
    size: '800 g',
    price: 249,
    image: '/media/curd-800g.jpg',
    art: 'curd-800',
    label: 'Preorder',
    preorder: true,
    pack: { grams: 800, packLabel: '800 g pot' },
    summary:
      'Thick curd set slow in clay pots from the same milk the ghee is churned from, which is why it keeps longer and tastes of curd rather than milk. Made fresh each day we churn.',
    specs: [
      ['Net weight', '800 g'],
      ['Method', 'Slow-set in clay pots'],
      ['Availability', `Preorder, ${PREORDER_NOTICE_DAYS} days notice`],
      ['Storage', 'Refrigerate below 5°C'],
    ],
  },
};

export const productKeys = Object.keys(products);

export const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function productArt(key) {
  const product = products[key];
  if (!product) return '';
  return `data:image/svg+xml,${encodeURIComponent(bottleArt(key, product.art))}`;
}

/* A product's photograph when it has one, otherwise the drawn art. Every screen
   resolves its image through here so the rule is stated once. The cart and the
   shop already preferred the photograph; the checkout was calling `productArt`
   directly and so drew a ghee jar where the cart showed a photograph of one. */
export function productImage(key) {
  return products[key]?.image || productArt(key);
}

/* The one photograph that belongs to no single product: all four together. It
   is landscape, which is what the expanded shop panel wants, and it replaces a
   strip of ghee-only process frames that used to sit there — frames the butter
   and curd cards were also being shown, which was simply wrong for them. */
export const groupImage = '/media/ghee-group.jpg';

/* ---------- Pack maths ----------

   Butter and curd are sold by weight, so a stepper needs to turn "2" into both
   a weight and a price. Doing that here rather than in the page keeps the
   arithmetic in one place, and `packFor` returning null for ghee is what the
   shop uses to decide whether to draw a stepper at all. */

export function packFor(key) {
  return products[key]?.pack ?? null;
}

export function packTotalGrams(key, blocks) {
  const pack = packFor(key);
  return pack ? pack.grams * blocks : 0;
}

/* One price per product, always. An earlier version stored a per-kilo rate on
   the pack and multiplied it back up to get a block price, and curd's rate of
   312 made two pots come to 499.20 — the cart then charged a rupee less than
   the label on the card. Multiplying whole packs avoids that class of drift. */
export function packTotalPrice(key, blocks) {
  const product = products[key];
  return product ? product.price * blocks : 0;
}

/* "1.5 kg" / "800 g" - reads the way the farm would say it out loud. */
export function formatWeight(grams) {
  if (!grams) return '';
  if (grams >= 1000) {
    const kg = grams / 1000;
    return `${Number.isInteger(kg) ? kg : kg.toFixed(2).replace(/0$/, '')} kg`;
  }
  return `${grams} g`;
}

export function cartCount(cart) {
  return Object.values(cart).reduce((total, quantity) => total + quantity, 0);
}

export function cartTotal(cart) {
  return Object.entries(cart).reduce(
    (total, [key, quantity]) => total + (products[key] ? products[key].price * quantity : 0),
    0,
  );
}

export function writeCart(cart) {
  try {
    window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
    return true;
  } catch {
    return false;
  }
}

export function addCartItem(cart, key, amount = 1) {
  if (!(key in products)) return readCart();
  const next = { ...cart };
  next[key] = Math.min(Math.max(next[key] + amount, 0), 9);
  return writeCart(next) ? next : readCart();
}

/* Built from productKeys rather than listing keys by hand: a cart that
   hardcoded two products silently dropped every product added after them. */
export function emptyCart() {
  return productKeys.reduce((cart, key) => ({ ...cart, [key]: 0 }), {});
}

export function readCart() {
  const cart = emptyCart();
  try {
    const savedCart = JSON.parse(window.localStorage.getItem(cartStorageKey));
    if (!savedCart || typeof savedCart !== 'object') return cart;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    return productKeys.reduce((next, key) => {
      next[key] = clamp(Math.trunc(Number(savedCart[key])) || 0, 0, 9);
      return next;
    }, cart);
  } catch {
    return cart;
  }
}

export function cartEntries(cart) {
  return Object.entries(cart).filter(([key, quantity]) => quantity > 0 && key in products);
}

export function cartHasPreorder(cart) {
  return cartEntries(cart).some(([key]) => products[key].preorder);
}
