/* Code 128, the barcode on the receipt.

   The design this card came from draws its bars from a seeded pseudo-random
   generator — `Math.sin(seed + index)` picking a width — which means the bars
   look like a barcode and encode nothing at all. It cannot: no scanner reads it,
   and the strip is different every time for reasons that have nothing to do with
   the order. A barcode that cannot be read is worse than no barcode, because it
   claims to be carrying something.

   So this encodes the order reference for real. The reference is digits and a
   dash, all of which sit inside Code 128 set B, and the output is the module
   width sequence every scanner already understands.

   Set B alone, and not the set C digit-packing optimisation. Set C would make a
   ten-character reference roughly a third shorter, which on a card that already
   fits is worth nothing, and it costs a second code path through the checksum and
   two switch codes to get wrong. A reference is ten characters; correctness is
   the whole point of having a barcode at all.

   The table below is the one from the standard: 107 patterns of six module
   widths (bar, space, bar, space, bar, space), except the stop pattern which has
   seven because it carries the trailing bar. Written out rather than derived,
   because it is published data and there is no arithmetic that produces it. */

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/* Set B covers printable ASCII, and the standard lays the table out so a
   character's pattern index is its code point minus 32. Anything below a space or
   above a tilde is not in set B and is refused rather than drawn as the wrong
   character — a barcode of the wrong thing is a barcode that lies. */
function setBValue(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 32 || codePoint > 126) return null;
  return codePoint - 32;
}

/* The code sequence: start, one code per character, the checksum, stop. */
function encode(value) {
  const text = String(value ?? '');
  if (!text) return null;

  const codes = [];
  for (const character of text) {
    const code = setBValue(character.codePointAt(0));
    if (code === null) return null;
    codes.push(code);
  }

  /* The modulo-103 weighted sum. The start code counts as weight 1 and the first
     data character as weight 1 after it — which is why `codes` is not simply
     summed from zero. */
  let sum = START_B;
  codes.forEach((code, index) => {
    sum += code * (index + 1);
  });

  return [START_B, ...codes, sum % 103, STOP];
}

/* One code's width pattern expanded into modules, a 1 for ink and a 0 for paper. */
function modulesForCode(code) {
  const modules = [];
  let bar = true;
  for (const width of PATTERNS[code]) {
    for (let i = 0; i < Number(width); i += 1) modules.push(bar ? 1 : 0);
    bar = !bar;
  }
  return modules;
}

/* The bar widths, as run-lengths: positive for a bar, negative for the space
   after it. Returned alongside the modules because this is the form the standard
   is published in, which is what lets scripts/check-barcode.mjs pin the encoder
   against the documented example instead of against itself. */
export function barcodeRuns(value) {
  const codes = encode(value);
  if (!codes) return null;

  const runs = [];
  for (const code of codes) {
    let bar = true;
    for (const width of PATTERNS[code]) {
      runs.push(bar ? Number(width) : -Number(width));
      bar = !bar;
    }
  }
  return runs;
}

/* The modules to draw. Quiet zones are added by the renderer, not here, so what
   comes back is exactly what the standard specifies. */
export function barcodeModules(value) {
  const codes = encode(value);
  if (!codes) return null;

  const modules = [];
  for (const code of codes) modules.push(...modulesForCode(code));
  return modules;
}

/* Reads module widths back into the string they came from.

   Exists for the check, and shipped so the round-trip is honest. It works in the
   opposite direction from the encoder: runs of modules become run-lengths, each
   six-run group is looked up in the table, and the modulo-103 checksum has to
   agree before a single character is emitted. A barcode that draws but does not
   decode is exactly the failure the component this replaced had, and the only way
   to know it does not happen is to decode it. */
export function decodeModules(modules) {
  if (!Array.isArray(modules) || modules.length === 0) return null;

  /* Runs of modules, alternating bar and space starting with a bar. The quiet zone
     of zeroes at either end is dropped, because a scanner ignores it and the
     decoder should too. */
  let from = 0;
  let to = modules.length;
  while (from < to && modules[from] === 0) from += 1;
  while (to > from && modules[to - 1] === 0) to -= 1;
  if (to - from < 6) return null;

  const runs = [];
  let current = modules[from];
  let length = 0;
  for (let i = from; i < to; i += 1) {
    if (modules[i] === current) {
      length += 1;
    } else {
      runs.push(current === 1 ? length : -length);
      current = modules[i];
      length = 1;
    }
  }
  runs.push(current === 1 ? length : -length);

  /* Start is six runs and the stop pattern is seven; between them sit the data
     characters and the checksum, six runs each. */
  if (runs.length < 6 + 7) return null;
  if ((runs.length - 6 - 7) % 6 !== 0) return null;

  const patternOf = new Map(PATTERNS.map((pattern, index) => [pattern, index]));
  const groupToCode = (start) => {
    const pattern = runs
      .slice(start, start + 6)
      .map((run) => String(Math.abs(run)))
      .join('');
    return patternOf.get(pattern);
  };

  const startCode = groupToCode(0);
  if (startCode !== START_B) return null;

  const stopPattern = runs
    .slice(runs.length - 7)
    .map((run) => String(Math.abs(run)))
    .join('');
  if (stopPattern !== PATTERNS[STOP]) return null;

  const codes = [];
  for (let i = 6; i < runs.length - 7; i += 6) {
    const code = groupToCode(i);
    if (code === undefined) return null;
    codes.push(code);
  }

  const checksum = codes.pop();
  let sum = START_B;
  codes.forEach((code, index) => {
    sum += code * (index + 1);
  });
  if (sum % 103 !== checksum) return null;

  let out = '';
  for (const code of codes) {
    if (code > 95) return null; /* a function code, which this encoder never emits */
    out += String.fromCharCode(code + 32);
  }
  return out;
}

/* The barcode as one SVG string.

   Injected rather than assembled node by node, because the receipt is built in
   one place and this is a fixed shape. `aria-hidden` because the reference is
   already set in text directly above it, and a screen reader reading out a strip
   of bars is just the same number again. */
export function barcodeSvg(value, { width = 250, height = 70 } = {}) {
  const modules = barcodeModules(value);
  if (!modules) return '';

  /* Ten modules of quiet zone either side. Scanners need it to find the first
     bar, and it is invisible — the space the design's card already had. */
  const quiet = 10;
  const unit = width / (modules.length + quiet * 2);
  const barHeight = height * 0.7;
  const top = Math.round((height - barHeight) / 2);

  let rects = '';
  for (let i = 0; i < modules.length; i += 1) {
    if (!modules[i]) continue;
    const x = ((i + quiet) * unit).toFixed(2);
    /* Never thinner than one device pixel. A sub-pixel bar can be dropped
       entirely by the rasteriser, which quietly turns a scannable barcode into a
       stripey one that only looks like it works. */
    const w = Math.max(unit, 100 / width).toFixed(2);
    rects += `<rect x="${x}" y="${top}" width="${w}" height="${barHeight}" />`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false" ` +
    `fill="currentColor">${rects}</svg>`
  );
}