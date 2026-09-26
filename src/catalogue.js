import { bottleArt } from './bottles.js';

export const cartStorageKey = 'uppalapati-farms-cart';

export const products = {
  'half-litre': {
    name: 'Half-litre ghee',
    size: '500 ml',
    price: 699,
    image: '/media/ghee-jar-100ml.jpg',
    art: 'bottle-500',
  },
  'one-litre': {
    name: 'One-litre ghee',
    size: '1 L',
    price: 1299,
    image: '/media/ghee-jar-500ml.jpg',
    art: 'bottle-1000',
  },
};

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
