import { products, currency, PREORDER_NOTICE_DAYS } from './catalogue.js';

/* ---------- Business profile ----------
   Values marked TODO are still demo placeholders and must be replaced
   with the client's real details before this goes live — no other file
   needs to change. */

export const business = {
  name: 'Uppalapati Farms',
  tagline: 'Ghee, made slowly.',
  // wa.me needs country code + number with no +, spaces, or dashes.
  whatsappNumber: '919908854444',
  phoneDisplay: '+91 99088 54444',
  email: 'hello@uppalapatifarms.example', // TODO real address
  // Registered premises, as printed on the FSSAI registration certificate.
  address: '1-37, Uppalapati Nagar, Poranki (Rural), Penamaluru, Krishna District, Andhra Pradesh 521137',
  hours: 'Monday to Saturday, 9am – 7pm IST', // TODO confirm hours
  fssai: 'FSSAI Reg. No. 20126121000520',
  // Shown as a demo notice wherever enquiries are collected.
  demoNotice: 'This is a design demo. No order or payment is processed.',
};

/* ---------- FSSAI registration ----------
   Transcribed from the registration certificate held by the client.
   Note this is a *registration* under the FSS Act, 2006 (annual turnover
   up to Rs 1.5 crore), not a 14-digit licence. Keeping the wording exact
   matters: calling it a "licence" is a factual error on a food product. */

export const registration = {
  number: '20126121000520',
  displayNumber: 'FSSAI Reg. No. 20126121000520',
  instrument: 'Registration Certificate',
  status: 'Registration Certificate issued',
  scheme: 'Issued under the Food Safety and Standards Act, 2006',
  authority: 'Government of Andhra Pradesh',
  holder: 'Uppalapati Radhika',
  premises:
    '1-37, Uppalapati Nagar, Poranki, Poranki (Rural), Penamaluru, Krishna, Andhra Pradesh 521137',
  kindOfBusiness: 'Retailer, Distributor',
  registeringAuthority: 'Krishna',
  issuedOn: '6 July 2026',
  feePaidUpto: '5 July 2031',
  annualFee: '₹500',
  suspension: 'None recorded',
  turnoverCap: '₹1.5 crore per year',
  helpline: '1800112100',
  verifyUrl: 'https://foscos.fssai.gov.in',
  verifyLabel: 'Food Safety Compliance System (FoSCoS)',
  certificate: '/media/fssai-registration.pdf',
  categories: [
    {
      code: '04',
      label: 'Fruits and vegetables',
      detail:
        'Including mushrooms and fungi, roots and tubers, fresh pulses and legumes, and aloe vera; seaweeds; nuts and seeds.',
    },
    {
      code: '06',
      label: 'Cereals and cereal products',
      detail:
        'Derived from cereal grains, roots and tubers, pulses, legumes and pith or soft core of palm tree, excluding bakery wares of food category 7.0.',
    },
    { code: '12', label: 'Salts, spices, soups, sauces, salads and protein products' },
    { code: '13', label: 'Foodstuffs intended for particular nutritional uses' },
    { code: '14', label: 'Beverages, excluding dairy products' },
    { code: '15', label: 'Ready-to-eat savouries' },
    { code: '16', label: 'Prepared foods' },
  ],
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
  const lines = [
    `Hello ${business.name},`,
    '',
    `I would like to order: ${product.name} (${product.size}) — ${currency.format(product.price)}`,
  ];
  if (product.preorder) {
    lines.push('', `This is a preorder item. I understand it needs ${PREORDER_NOTICE_DAYS} days notice.`);
  }
  lines.push('', 'Please share delivery details.');
  return lines.join('\n');
}

export function cartEnquiryMessage(cart) {
  const entries = Object.entries(cart).filter(([key, quantity]) => quantity > 0 && key in products);
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
    const tag = product.preorder ? '  [preorder]' : '';
    lines.push(`• ${product.name} (${product.size}) × ${quantity} — ${currency.format(product.price * quantity)}${tag}`);
  });
  lines.push('', `Total: ${currency.format(total)}`);
  // Only claim the lead time when something in the cart actually needs it.
  const needsLead = entries.some(([key]) => products[key].preorder);
  if (needsLead) {
    lines.push('', `Note: this order includes preorder items that need ${PREORDER_NOTICE_DAYS} days notice.`);
  }
  lines.push('', 'Please confirm availability and delivery.');
  return lines.join('\n');
}
