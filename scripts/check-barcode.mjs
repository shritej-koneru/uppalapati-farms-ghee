/* Does the receipt's barcode actually carry the order reference?

   The component this replaced drew its bars from a seeded random number
   generator, so it looked like a barcode and decoded to nothing. That failure is
   invisible to any test that only checks the bars are the right colour, which is
   how it survived. So this round-trips: encode, then read the module widths back
   with a decoder and insist the reference comes out again.

   The anchor is the standard's own worked example — "Wikipedia" in set B, whose
   published checksum is 88 and whose published width sequence is written out in
   full below. The decoder and the encoder are the same file, so without that
   published string the pair could agree on something wrong; with it, both the
   width table and the modulo-103 arithmetic are pinned to the standard rather
   than to themselves. */

import { barcodeModules, barcodeRuns, decodeModules, barcodeSvg } from '../src/barcode.js';

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`  FAIL  ${label}`);
    console.error(`          expected ${JSON.stringify(expected)}`);
    console.error(`          got      ${JSON.stringify(actual)}`);
  } else {
    console.log(`  PASS  ${label}`);
  }
}

/* The published sequence for "Wikipedia" in Code 128 set B: start B, nine data
   characters, checksum 88, stop. Every group below is the standard's own width
   pattern for that code — start B is 211214, stop is 2331112, checksum 88 is
   421211. Nothing here comes from src/barcode.js. */
const WIKIPEDIA =
  '211214' + // start B
  '311321' + // W
  '142112' + // i
  '241211' + // k
  '142112' + // i
  '111242' + // p
  '112214' + // e
  '141221' + // d
  '142112' + // i
  '121124' + // a
  '421211' + // checksum 88
  '2331112'; // stop

check(
  'the width sequence matches the standard',
  barcodeRuns('Wikipedia').map((run) => String(Math.abs(run))).join(''),
  WIKIPEDIA,
);
check("the standard's example decodes back", decodeModules(barcodeModules('Wikipedia')), 'Wikipedia');

/* Every day-scoped reference shape, which is all the receipt ever carries. */
const references = [
  '041026-001',
  '041026-005',
  '041026-042',
  '041026-999',
  '051026-001',
  '121026-100',
  '010127-010',
  '311229-001',
  '041226-100',
];

for (const reference of references) {
  check(`${reference} round-trips`, decodeModules(barcodeModules(reference)), reference);
}

/* One digit more than three, to prove the sequence is padded and not truncated:
   the tenth order of the day must not collide with the hundredth. */
check('a four-digit sequence round-trips', decodeModules(barcodeModules('041026-1000')), '041026-1000');

/* Two different references must not produce the same bars. The seeded-random
   component would have failed this the moment two references collided. */
const seen = new Map();
let collisions = 0;
for (const reference of references) {
  const key = barcodeModules(reference).join('');
  if (seen.has(key)) collisions += 1;
  seen.set(key, reference);
}
check('every reference gets its own bars', collisions, 0);
check('every reference has its own widths', seen.size, references.length);

/* Letters and punctuation, so set B alone is proven rather than assumed. */
check('letters round-trip', decodeModules(barcodeModules('UF-0001')), 'UF-0001');
check(
  'the whole printable range round-trips',
  decodeModules(barcodeModules(' !"#$%&\'()*+,-./0123456789:;<=>?@AZ[\\]^_`az{|}~')),
  ' !"#$%&\'()*+,-./0123456789:;<=>?@AZ[\\]^_`az{|}~',
);

/* Long enough to use every pattern in the table more than once. */
check('a long number round-trips', decodeModules(barcodeModules('41126119991231000')), '41126119991231000');

/* Characters outside set B are refused, not drawn as something else. */
check('an empty reference is refused', barcodeModules(''), null);
check('undefined is refused', barcodeModules(undefined), null);
check('null is refused', barcodeModules(null), null);
check('a newline is refused', barcodeModules('0410\n26'), null);
check('a non-ASCII character is refused', barcodeModules('041026-ä'), null);
check('an emoji is refused', barcodeModules('041026-🎉'), null);

/* A corrupted barcode must break the checksum rather than decode to a different
   order number — which is what a barcode that silently misreads would cause. */
const good = barcodeModules('041026-005');
let corruptedStillReads = 0;
for (let i = 0; i < good.length; i += 1) {
  const flipped = good.map((module, index) => (index === i ? (module ? 0 : 1) : module));
  if (decodeModules(flipped) === '041026-005') corruptedStillReads += 1;
}
check('no single-module corruption decodes to the same reference', corruptedStillReads, 0);

/* The SVG has to be a shape that prints and scans: a viewBox, ink-coloured bars,
   no text a screen reader would repeat, and a quiet zone a scanner can find. */
const svg = barcodeSvg('041026-005');
check('the svg carries a viewBox', svg.includes('viewBox="0 0 250 70"'), true);
check('the svg is aria-hidden', svg.includes('aria-hidden="true"'), true);
check('the svg uses currentColor', svg.includes('fill="currentColor"'), true);
check('the svg draws bars', (svg.match(/<rect /g) || []).length > 40, true);
check('the svg has no text for a screen reader to read twice', svg.includes('<text'), false);
check('the svg refuses to draw an unencodable value', barcodeSvg('bad\nvalue'), '');

/* The first bar must sit ten modules in, and no bar may be thinner than a device
   pixel — a dropped bar turns a scannable barcode into a decorative one. */
const moduleCount = barcodeModules('041026-005').length;
const unit = 250 / (moduleCount + 20);
const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)].map((m) => ({
  x: Number(m[1]),
  width: Number(m[2]),
}));

check('the svg draws a plausible number of bars', rects.length > 40, true);
check('the quiet zone is ten modules', Math.abs(rects[0].x / unit - 10) < 0.1, true);
check('no bar is thinner than one device pixel', Math.min(...rects.map((r) => r.width)) >= 1, true);

/* The bars have to reach the right-hand quiet zone as well. A renderer that
   dropped the last few would still pass a colour check and still be unscannable
   from the other end. */
const lastBar = rects[rects.length - 1];
check('the bars reach the far quiet zone', Math.abs((250 - (lastBar.x + lastBar.width)) / unit - 10) < 0.1, true);
check('the bars start on the first module', Math.abs(rects[0].width - unit) < 0.01, true);

console.log('');
if (failures > 0) {
  console.error(`The barcode is wrong in ${failures} of ${checks} checks.`);
  process.exit(1);
}
console.log(`The receipt barcode carries the reference: ${checks} checks.`);