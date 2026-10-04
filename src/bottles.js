const LABEL_SERIF = "Georgia, 'Times New Roman', serif";

function gradients(id) {
  return `<defs>
    <linearGradient id="ghee-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8cd60"/>
      <stop offset="0.55" stop-color="#e29a20"/>
      <stop offset="1" stop-color="#a96810"/>
    </linearGradient>
    <linearGradient id="lid-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0d089"/>
      <stop offset="1" stop-color="#b07f2a"/>
    </linearGradient>
  </defs>`;
}

export function jarArt(id) {
  return `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Uppalapati Farms pure ghee jar">
    ${gradients(id)}
    <rect x="61" y="8" width="78" height="24" rx="7" fill="url(#lid-${id})" stroke="rgba(84,56,12,0.4)"/>
    <g stroke="rgba(84,56,12,0.18)" stroke-width="2">
      <line x1="74" y1="11" x2="74" y2="29"/>
      <line x1="87" y1="11" x2="87" y2="29"/>
      <line x1="100" y1="11" x2="100" y2="29"/>
      <line x1="113" y1="11" x2="113" y2="29"/>
      <line x1="126" y1="11" x2="126" y2="29"/>
    </g>
    <ellipse cx="100" cy="40" rx="57" ry="9" fill="#7c500c"/>
    <rect x="42" y="38" width="116" height="210" rx="24" fill="url(#ghee-${id})" stroke="rgba(255,248,225,0.42)" stroke-width="2"/>
    <ellipse cx="100" cy="42" rx="53" ry="7" fill="#f8d372" opacity="0.95"/>
    <rect x="53" y="50" width="13" height="184" rx="6.5" fill="rgba(255,255,255,0.26)"/>
    <rect x="50" y="122" width="100" height="86" rx="8" fill="#f6f1e7" stroke="rgba(58,44,18,0.14)"/>
    <text x="100" y="147" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="13" letter-spacing="1.4" font-weight="600" fill="#3a2c12">UPPALAPATI</text>
    <text x="100" y="163" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="10.5" letter-spacing="4" fill="#3a2c12">FARMS</text>
    <line x1="68" y1="172" x2="132" y2="172" stroke="#c99537"/>
    <text x="100" y="190" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="11" letter-spacing="2.6" font-weight="700" fill="#3a2c12">PURE GHEE</text>
    <text x="100" y="202" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="6.5" letter-spacing="1.2" fill="#8c621f">SMALL BATCH • FARM FRESH</text>
  </svg>`;
}

/* Butter and curd come out of the same churn as the ghee, so they are shown in
   the same squat glass jar rather than a bottle. The fill level is the only
   difference between the two, which is what makes them read as a pair. */
function tubArt(id, { label, sub, fill, fillTop, name }) {
  return `<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Uppalapati Farms ${name}">
    ${gradients(id)}
    <rect x="52" y="6" width="96" height="26" rx="9" fill="url(#lid-${id})" stroke="rgba(84,56,12,0.4)"/>
    <g stroke="rgba(84,56,12,0.18)" stroke-width="2">
      <line x1="66" y1="9" x2="66" y2="29"/>
      <line x1="82" y1="9" x2="82" y2="29"/>
      <line x1="100" y1="9" x2="100" y2="29"/>
      <line x1="118" y1="9" x2="118" y2="29"/>
      <line x1="134" y1="9" x2="134" y2="29"/>
    </g>
    <path d="M56,32 L144,32 L152,52 L48,52 Z" fill="#7c500c"/>
    <rect x="34" y="50" width="132" height="150" rx="26" fill="url(#ghee-${id})" stroke="rgba(255,248,225,0.42)" stroke-width="2"/>
    <rect x="${fill}" y="${fillTop}" width="${200 - fill * 2}" height="${206 - fillTop}" rx="10" fill="${name === 'pot curd' ? '#fbf7ee' : '#f6d67d'}" opacity="0.94"/>
    <ellipse cx="100" cy="50" rx="60" ry="8" fill="${name === 'pot curd' ? '#ffffff' : '#f8d372'}" opacity="0.95"/>
    <rect x="46" y="62" width="14" height="126" rx="7" fill="rgba(255,255,255,0.26)"/>
    <rect x="42" y="118" width="116" height="70" rx="8" fill="#f6f1e7" stroke="rgba(58,44,18,0.14)"/>
    <text x="100" y="140" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="12" letter-spacing="1.4" font-weight="600" fill="#3a2c12">UPPALAPATI</text>
    <text x="100" y="154" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="9.5" letter-spacing="3.6" fill="#3a2c12">FARMS</text>
    <line x1="68" y1="162" x2="132" y2="162" stroke="#c99537"/>
    <text x="100" y="178" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="10.5" letter-spacing="1.8" font-weight="700" fill="#3a2c12">${label}</text>
    <text x="100" y="189" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="6" letter-spacing="0.9" fill="#8c621f">${sub}</text>
  </svg>`;
}

export function bottleArt(id, kind = 'bottle-1000') {
  if (kind === 'butter-500') {
    return tubArt(id, { name: 'cultured butter', label: 'CULTURED BUTTER', sub: '500 g • PREORDER', fill: 44, fillTop: 92 });
  }
  if (kind === 'curd-800') {
    return tubArt(id, { name: 'pot curd', label: 'POT CURD', sub: '800 g • PREORDER', fill: 40, fillTop: 70 });
  }
  if (kind === 'bottle-500') {
    return `<svg viewBox="0 0 120 214" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Uppalapati Farms 500 ml ghee bottle">
      ${gradients(id)}
      <rect x="45" y="4" width="30" height="18" rx="5" fill="url(#lid-${id})" stroke="rgba(84,56,12,0.4)"/>
      <rect x="50" y="20" width="20" height="28" fill="url(#ghee-${id})" opacity="0.85"/>
      <path d="M50,46 C28,62 23,74 23,92 L23,198 Q23,210 35,210 L85,210 Q97,210 97,198 L97,92 C97,74 92,62 70,46 Z" fill="url(#ghee-${id})" stroke="rgba(255,248,225,0.42)" stroke-width="2"/>
      <rect x="33" y="86" width="9" height="104" rx="4.5" fill="rgba(255,255,255,0.24)"/>
      <rect x="31" y="106" width="58" height="86" rx="6" fill="#f6f1e7" stroke="rgba(58,44,18,0.14)"/>
      <text x="60" y="126" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="8.5" letter-spacing="0.8" font-weight="600" fill="#3a2c12">UPPALAPATI</text>
      <text x="60" y="137" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="7.5" letter-spacing="2.4" fill="#3a2c12">FARMS</text>
      <line x1="42" y1="144" x2="78" y2="144" stroke="#c99537"/>
      <text x="60" y="160" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="8.5" letter-spacing="1.8" font-weight="700" fill="#3a2c12">PURE GHEE</text>
      <text x="60" y="176" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="7" letter-spacing="1" fill="#8c621f">500 ml • HALF LITRE</text>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Uppalapati Farms one litre ghee bottle">
    ${gradients(id)}
    <rect x="45" y="4" width="30" height="18" rx="5" fill="url(#lid-${id})" stroke="rgba(84,56,12,0.4)"/>
    <rect x="50" y="20" width="20" height="34" fill="url(#ghee-${id})" opacity="0.85"/>
    <path d="M50,52 C27,68 22,82 22,102 L22,284 Q22,296 34,296 L86,296 Q98,296 98,284 L98,102 C98,82 93,68 70,52 Z" fill="url(#ghee-${id})" stroke="rgba(255,248,225,0.42)" stroke-width="2"/>
    <rect x="32" y="98" width="9" height="172" rx="4.5" fill="rgba(255,255,255,0.24)"/>
    <rect x="30" y="146" width="60" height="94" rx="6" fill="#f6f1e7" stroke="rgba(58,44,18,0.14)"/>
    <text x="60" y="168" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="8.5" letter-spacing="0.8" font-weight="600" fill="#3a2c12">UPPALAPATI</text>
    <text x="60" y="180" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="7.5" letter-spacing="2.4" fill="#3a2c12">FARMS</text>
    <line x1="42" y1="188" x2="78" y2="188" stroke="#c99537"/>
    <text x="60" y="206" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="8.5" letter-spacing="1.8" font-weight="700" fill="#3a2c12">PURE GHEE</text>
    <text x="60" y="222" text-anchor="middle" font-family="${LABEL_SERIF}" font-size="7" letter-spacing="1" fill="#8c621f">1 LITRE • 1000 ml</text>
  </svg>`;
}
