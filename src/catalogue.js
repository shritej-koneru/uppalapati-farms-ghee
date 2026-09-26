import { bottleArt } from './bottles.js';

export const cartStorageKey = 'uppalapati-farms-cart';

export const products = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 699,
    image: '/media/ghee-jar-100ml.jpg',
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
    price: 1299,
    image: '/media/ghee-jar-500ml.jpg',
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

export function readCart() {
  const emptyCart = { 'half-litre': 0, 'one-litre': 0 };
  try {
    const savedCart = JSON.parse(window.localStorage.getItem(cartStorageKey));
    if (!savedCart || typeof savedCart !== 'object') return emptyCart;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    return {
      'half-litre': clamp(Math.trunc(Number(savedCart['half-litre'])) || 0, 0, 9),
      'one-litre': clamp(Math.trunc(Number(savedCart['one-litre'])) || 0, 0, 9),
    };
  } catch {
    return emptyCart;
  }
}
