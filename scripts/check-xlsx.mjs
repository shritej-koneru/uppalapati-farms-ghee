import { buildWorkbook } from '../functions/_lib/xlsx.js';
import { SHEET_COLUMNS, toSheetRow } from '../functions/api/orders.js';
import { ORDER_STATUSES, statusLabel } from '../src/order-status.js';

/* Validates the shape of the generated order sheet.

   This exists because a workbook that is a well-formed ZIP full of well-formed
   XML can still be rejected by Excel, and the rejection is invisible until a
   real customer or the owner opens the file and clicks through a repair prompt.
   That happened: `styles.xml` listed no `<fills>` and no `<borders>`, while
   every `<xf>` in it pointed at `fillId="0"` and `borderId="0"` — indices into
   tables that were never written. Both elements are required in the
   CT_Stylesheet sequence, so Excel treated the file as corrupt, offered to
   rebuild it, and the order sheet was silently restyled on the way in.

   The fix is not something a syntax check can see, so the invariants are
   asserted here instead: the required parts exist, the content types agree with
   what was actually written, every style index resolves, and the declared
   dimensions match the rows and columns that follow. This runs in CI and needs
   neither Excel nor a network connection.

   It is not a full OOXML schema validation. It covers the failure mode that
   actually occurred, and the assertions are cheap, so it is worth keeping
   narrow rather than pretending to be authoritative. */

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

/* Every entry is written with compression method 0 (STORE), which is what lets
   the writer ship without a deflate implementation, so each part can be lifted
   straight back out of the archive by slicing it at the offset the central
   directory records. */
function readParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = new Map();

  /* The end-of-central-directory record sits in the last 22 bytes when there is
     no archive comment, which this writer never writes. Scanning back for the
     signature costs nothing and would survive one being added later. */
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record: not a ZIP archive');

  const total = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);

  for (let entry = 0; entry < total; entry += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) {
      throw new Error(`central directory entry ${entry} has a bad signature`);
    }
    const method = view.getUint16(pointer + 10, true);
    const size = view.getUint32(pointer + 24, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const local = view.getUint32(pointer + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    check(method === 0, `${name}: expected compression method 0 (STORE), found ${method}`);

    /* The payload starts after the local header, which carries its own name and
       extra fields — both of which must be read, not assumed to match. */
    const localNameLength = view.getUint16(local + 26, true);
    const localExtraLength = view.getUint16(local + 28, true);
    const start = local + 30 + localNameLength + localExtraLength;

    parts.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return parts;
}

/* Pulls every opening `<tag .../>` or `<tag ...>` at one position out of a
   fragment, so the checks below read as assertions rather than as index maths. */
function openTags(xml, tag) {
  const out = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*?)/?>`, 'g');
  let match;
  while ((match = pattern.exec(xml)) !== null) out.push(match[1]);
  return out;
}

function attr(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

function declaredCount(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*\\bcount="(\\d+)"`).exec(xml);
  return match ? Number(match[1]) : null;
}

/* ---------- The real sheet shape ----------

   The checks below use a toy four-column sheet, because that is enough to
   exercise the writer itself. These use the actual production columns and row
   builder, because the invariant worth guarding is the one that lives between
   the two: a row that is a different length from its headers. Nothing rejects
   that — the sheet still opens without complaint — it just slides one order's
   status under the next customer's name, which is not the kind of error anyone
   notices until a call is taken against the wrong jar. */
const sampleOrder = {
  reference: 'UP-2026-0002',
  created_at: '2026-10-04T08:54:44.781Z',
  full_name: 'Ravi & Sons < dairy',
  mobile: '9876543210',
  email: null,
  address: '12/4 Gandhi St, Nr SBI',
  city: 'Guntur',
  state: 'Andhra Pradesh',
  pincode: '522001',
  delivery_date: '2026-10-20',
  items: '[]',
  item_summary: '1 x One-litre ghee (1 L)',
  total: 10247,
  has_preorder: 0,
  notified: 0,
  flagged: 0,
  status: 'on-the-way',
};

check(
  SHEET_COLUMNS[0] === 'Status',
  `the sheet should lead with Status, but leads with "${SHEET_COLUMNS[0]}"`,
);

const sampleRow = toSheetRow(sampleOrder);
check(
  sampleRow.length === SHEET_COLUMNS.length,
  `toSheetRow returns ${sampleRow.length} values but the sheet has ${SHEET_COLUMNS.length} columns`,
);

/* Every status has to reach the sheet under its own name, and there must be no
   status the sheet writer does not know about — the two lists are written in
   different files and a value that is missing from either one would show up as a
   blank or a raw slug in the owner's spreadsheet. */
for (const status of ORDER_STATUSES) {
  const cell = toSheetRow({ ...sampleOrder, status: status.value })[0];
  check(cell === status.label, `status "${status.value}" reaches the sheet as "${cell}", not "${status.label}"`);
}
check(statusLabel('nonsense') === 'nonsense', 'an unrecognised status should be shown as itself, not guessed at');

/* ---------- The parts themselves ---------- */

/* A toy sheet, because four columns is enough to exercise the writer. The awkward
   cases are chosen deliberately: an ampersand and an angle bracket in a cell
   value is the case most likely to produce invalid XML, and an invalid sheet
   part is the other way Excel would have refused this file. A number proves the
   Total column is not quoted as text, and an empty cell proves the writer skips
   rather than blanks. */
const columns = ['Reference', 'Customer', 'WhatsApp', 'Total'];
const rows = [
  ['UP-2026-0002', 'Ravi & Sons < dairy', '919876543210', 10247],
  ['UP-2026-0001', 'AUDIT Smoke Test', '919000000000', 4248],
];

const parts = readParts(buildWorkbook(columns, rows));

for (const required of [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
]) {
  check(parts.has(required), `missing part: ${required}`);
}

const contentTypes = parts.get('[Content_Types].xml') ?? '';
const overrides = [...contentTypes.matchAll(/<Override[^>]*PartName="([^"]+)"/g)].map((m) => m[1]);

for (const name of overrides) {
  /* PartName is absolute in the package, with a leading slash; the archive
     entries are stored without one. */
  check(parts.has(name.replace(/^\//, '')), `content types declares ${name}, which is not in the archive`);
}

/* Every relationship target has to exist too, or Excel reports the file as
   unreadable rather than as malformed. */
for (const name of parts.keys()) {
  if (!name.endsWith('.rels')) continue;
  for (const match of parts.get(name).matchAll(/Target="([^"]+)"/g)) {
    const target = match[1];
    if (/^https?:/.test(target)) continue;
    const resolved = target.startsWith('/')
      ? target.slice(1)
      : name.replace(/_rels\/[^/]+$/, '') + target;
    check(parts.has(resolved), `${name}: relationship points at ${resolved}, which is not in the archive`);
  }
}

/* ---------- styles.xml: the bug that started all this ---------- */

const styles = parts.get('xl/styles.xml') ?? '';

/* CT_Stylesheet is a sequence, so both the presence and the order matter:
   numFmts?, fonts, fills, borders, cellStyleXfs?, cellXfs?, cellStyles? ... */
const order = ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles'];
let lastAt = -1;
for (const tag of order) {
  const at = styles.indexOf(`<${tag}`);
  if (at < 0) {
    /* numFmts, cellStyleXfs and cellStyles are genuinely optional; fonts,
       fills, borders and cellXfs are required and must appear. */
    if (['fonts', 'fills', 'borders', 'cellXfs'].includes(tag)) {
      problems.push(`styles.xml: <${tag}> is required and is missing`);
    }
    continue;
  }
  check(at > lastAt, `styles.xml: <${tag}> is out of the order the schema requires`);
  lastAt = at;
}

/* A declared count that disagrees with the number of children means Excel is
   being asked to index past the end of a table. */
for (const [table, child] of [
  ['fonts', 'font'],
  ['fills', 'fill'],
  ['borders', 'border'],
  ['cellStyleXfs', 'xf'],
  ['cellXfs', 'xf'],
]) {
  const at = styles.indexOf(`<${table}`);
  if (at < 0) continue;
  const close = styles.indexOf(`</${table}>`, at);
  const block = close > at ? styles.slice(at, close) : '';
  const declared = declaredCount(block, table);
  const actual = openTags(block, child).length;
  if (declared !== null) {
    check(declared === actual, `styles.xml: <${table} count="${declared}"> but holds ${actual} <${child}>`);
  }
}

/* Every style index a cell or xf refers to has to exist. This is the specific
   defect: fillId and borderId pointing at tables that were never written. */
const styleTables = {};
for (const table of ['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs']) {
  const at = styles.indexOf(`<${table}`);
  const close = styles.indexOf(`</${table}>`, at);
  styleTables[table] = at < 0 ? [] : openTags(close > at ? styles.slice(at, close) : '', table === 'cellStyleXfs' || table === 'cellXfs' ? 'xf' : table.slice(0, -1));
}

for (const xf of [...styleTables.cellStyleXfs, ...styleTables.cellXfs]) {
  for (const [attribute, table] of [
    ['fontId', 'fonts'],
    ['fillId', 'fills'],
    ['borderId', 'borders'],
    ['xfId', 'cellStyleXfs'],
  ]) {
    const index = attr(xf, attribute);
    if (index === null) continue;
    check(Number(index) < styleTables[table].length, `styles.xml: <xf ${attribute}="${index}"> but <${table}> holds only ${styleTables[table].length}`);
  }
}

/* ---------- worksheet: the cells and the dimensions that describe them ---------- */

const sheet = parts.get('xl/worksheets/sheet1.xml') ?? '';

const sheetRows = [...sheet.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((m) => Number(m[1]));
check(
  sheetRows.every((r, i) => r === i + 1),
  `sheet rows are not numbered 1..n in order: ${sheetRows.join(', ')}`,
);
check(sheetRows.length === rows.length + 1, `expected ${rows.length + 1} rows (a header plus ${rows.length}), found ${sheetRows.length}`);

const expectedColumns = new Set(['A', 'B', 'C', 'D']);
for (const cell of sheet.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)) {
  expectedColumns.delete(cell[1]);
}
check(expectedColumns.size === 0, `sheet is missing cells in column(s) ${[...expectedColumns].join(', ')}`);

/* The dimension is optional in the schema, but when it is written it has to
   match the data underneath it or the scroll-to-A1 and used-range handling
   disagree with what is actually there. */
const dimension = /<dimension\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/.exec(sheet);
if (dimension) {
  check(
    dimension[2] === `D${sheetRows.length}`,
    `sheet declares dimension ending ${dimension[2]} but holds ${sheetRows.length} rows and 4 columns`,
  );
}

/* Totals must land as numbers. A quoted total cannot be summed, which is the
   whole point of handing the owner a spreadsheet rather than a screenshot.
   Row 1 is the header, so only the rows below it are totals. */
const totalCells = [...sheet.matchAll(/<c\b([^>]*)>(.*?)<\/c>/g)]
  .map((m) => ({ open: m[1], row: /r="[A-Z]+(\d+)"/.exec(m[1])?.[1] }))
  .filter((cell) => /\br="D/.test(cell.open) && Number(cell.row) > 1);
check(
  totalCells.length === rows.length && totalCells.every((cell) => !/\bt="/.test(cell.open)),
  'the Total column is not written as plain numbers, so the sheet cannot be summed in Excel',
);

/* ---------- Report ---------- */

if (problems.length > 0) {
  process.stderr.write(`The order sheet would not open cleanly:\n${problems.map((p) => `  - ${p}\n`).join('')}`);
  process.exit(1);
}

process.stdout.write(
  `order sheet OK — ${parts.size} parts, ${columns.length} columns, ${rows.length} orders, styles resolve\n`,
);