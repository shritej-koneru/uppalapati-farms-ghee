import { products, currency } from './catalogue.js';

/* ---------- Placeholder business profile ----------
   Every value below is demo content. Replace each one with the
   client's real details before this goes live — no other file
   needs to change. */

export const business = {
  name: 'Uppalapati Farms',
  tagline: 'Ghee, made slowly.',
  // wa.me needs country code + number with no +, spaces, or dashes.
  whatsappNumber: '919000000000',
  phoneDisplay: '+91 90000 00000',
  email: 'hello@uppalapatifarms.example',
  address: 'Uppalapati Farms, Kakinada Road, Andhra Pradesh 533001',
  hours: 'Monday to Saturday, 9am – 7pm IST',
  fssai: 'FSSAI 12345678901234',
  // Shown as a demo notice wherever enquiries are collected.
  demoNotice: 'This is a design demo. No order or payment is processed.',
};

export const social = [
  { label: 'Instagram', href: 'https://instagram.com/' },
  { label: 'Facebook', href: 'https://facebook.com/' },
  { label: 'YouTube', href: 'https://youtube.com/' },
];

export function whatsappLink(message) {
  return `https://wa.me/${business.whatsappNumber}?text=${encodeURIComponent(message)}`;
}

export function generalEnquiryMessage() {
  return [
    `Hello ${business.name},`,
    '',
    'I would like to know more about your ghee.',
  ].join('\n');
}

export function contactEnquiryMessage(details) {
  const lines = [
    `Hello ${business.name},`,
    '',
    `Name: ${details.name}`,
    `Mobile: ${details.mobile}`,
  ];
  if (details.email) lines.push(`Email: ${details.email}`);
  lines.push(`Subject: ${details.subject}`);
  lines.push('', 'Message:', details.message);
  return lines.join('\n');
}

export function productEnquiryMessage(key) {
  const product = products[key];
  if (!product) return generalEnquiryMessage();
  return [
    `Hello ${business.name},`,
    '',
    `I would like to order: ${product.name} (${product.size}) — ${currency.format(product.price)}`,
    '',
    'Please share delivery details.',
  ].join('\n');
}

export function cartEnquiryMessage(cart) {
  const entries = Object.entries(cart).filter(([, quantity]) => quantity > 0);
  if (entries.length === 0) return generalEnquiryMessage();
  const total = entries.reduce((sum, [key, quantity]) => sum + products[key].price * quantity, 0);
  const lines = [
    `Hello ${business.name},`,
    '',
    'I would like to place an order:',
    '',
  ];
  entries.forEach(([key, quantity]) => {
    const product = products[key];
    lines.push(`• ${product.name} (${product.size}) × ${quantity} — ${currency.format(product.price * quantity)}`);
  });
  lines.push('', `Total: ${currency.format(total)}`, '', 'Please confirm availability and delivery.');
  return lines.join('\n');
}
