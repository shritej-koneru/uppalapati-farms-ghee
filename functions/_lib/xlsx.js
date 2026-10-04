/* ---------- Minimal .xlsx writer ----------

   A Cloudflare Worker has no filesystem and no zip library, but an .xlsx file
   *is* a zip archive holding a handful of XML parts. This builds one by hand.

   Two deliberate choices:

   - **Stored, not deflated.** Every entry uses compression method 0 (STORE), so
     the bytes written are the bytes stored and there is no need for a deflate
     implementation. Order sheets are a few kilobytes; the size saving from
     compressing them is not worth the dependency.
   - **Inline strings.** Cell text is written with `t="inlineStr"` rather than
     through a shared-strings table. That removes one whole part from the archive
     and the index bookkeeping that comes with it.

   This exists because the obvious alternative — writing rows into a stored
   .xlsx on every order — is how orders get lost. An .xlsx cannot be appended
   to; each new row means rewriting the entire archive, so two orders arriving
   together race and one overwrites the other. Orders go to D1 instead and this
   turns the database into a sheet when the owner asks for one. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/* Zip stores local time in two 16-bit fields with no timezone. Orders are read
   in India, so the timestamps are written in IST (+05:30) and a fixed date is
   used for every entry — the archive is generated in one go and never patched,
   so a per-entry date would only add noise. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; /* 2026-01-01 */

function zip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); /* version needed */
    localView.setUint16(6, 0, true); /* flags */
    localView.setUint16(8, 0, true); /* method: store */
    localView.setUint16(10, DOS_TIME, true);
    localView.setUint16(12, DOS_DATE, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true); /* extra length */
    local.set(nameBytes, 30);

    parts.push(local, data);

    const header = new Uint8Array(46 + nameBytes.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true); /* version made by */
    headerView.setUint16(6, 20, true); /* version needed */
    headerView.setUint16(8, 0, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, DOS_TIME, true);
    headerView.setUint16(14, DOS_DATE, true);
    headerView.setUint32(16, crc, true);
    headerView.setUint32(20, data.length, true);
    headerView.setUint32(24, data.length, true);
    headerView.setUint16(28, nameBytes.length, true);
    headerView.setUint16(30, 0, true); /* extra */
    headerView.setUint16(32, 0, true); /* comment */
    headerView.setUint16(34, 0, true); /* disk start */
    headerView.setUint16(36, 0, true); /* internal attrs */
    headerView.setUint32(38, 0, true); /* external attrs */
    headerView.setUint32(42, offset, true);
    header.set(nameBytes, 46);
    central.push(header);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const total = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const chunk of [...parts, ...central, end]) {
    total.set(chunk, cursor);
    cursor += chunk.length;
  }
  return total;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    /* Excel rejects most control characters outright, and a stray one from a
       pasted address would otherwise produce a file it refuses to open.

       Tab, newline and carriage return are kept: they are whitespace a customer
       genuinely typed into an address, and a spreadsheet cell can hold them.
       Everything else in the C0 range, plus C1, is dropped.

       no-control-regex is off for this line because matching control characters
       is the entire point — the rule exists to catch accidental use. */
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/* 0 -> A, 25 -> Z, 26 -> AA. Sheet column references need this. */
function columnName(index) {
  let name = '';
  let value = index;
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26) - 1;
  }
  return name;
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/* Builds a single-sheet workbook. `columns` is a list of header strings; each
   row is an array the same length. Numbers stay numbers so Excel can sum and
   sort them; everything else is written as inline text.

   `options.tintColumn` is an index into the row; cells in that column are
   filled with whichever colour `options.tints` holds for their text, and left
   unfilled when it holds none. Both are optional and both are deliberately
   ignorant of what a tint means — the caller supplies the colours and says which
   column they belong to, so this writer stays a writer and the shop's status
   list stays in `src/order-status.js` with everything else about status. */
export function buildWorkbook(columns, rows, options = {}) {
  const tints = options.tints ?? {};
  const tintNames = Object.keys(tints);

  const all = [columns, ...rows];
  const widest = all.reduce((max, row) => Math.max(max, row.length), 1);

  const sheetRows = all
    .map((row, rowIndex) => {
      const cells = [];
      for (let column = 0; column < widest; column += 1) {
        const value = row[column] ?? '';
        const reference = `${columnName(column)}${rowIndex + 1}`;

        /* Resolved to a cellXfs index, which is one per tint: the header is 1 and
           the plain cells are 0, so the tints start at 2. Looked up before the
           numeric test so a tint could apply to a number too, though today the
           only tinted column holds text. */
        const tint = tintNames.indexOf(String(value));
        const tintStyle = rowIndex > 0 && column === options.tintColumn && tint !== -1 ? 2 + tint : -1;

        if (isNumeric(value)) {
          cells.push(`<c r="${reference}"${tintStyle === -1 ? '' : ` s="${tintStyle}"`}><v>${value}</v></c>`);
        } else {
          const style = rowIndex === 0 ? ' s="1"' : tintStyle === -1 ? '' : ` s="${tintStyle}"`;
          cells.push(`<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`);
        }
      }
      return `<row r="${rowIndex + 1}">${cells.join('')}</row>`;
    })
    .join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(widest - 1)}${all.length}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="${widest}" width="18" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`;

  /* Bold on row 1 so the header line is readable when the file is opened.

     `fills` and `borders` are not optional decoration. CT_Stylesheet is a
     sequence in which both are required, and every <xf> below points at
     fillId 0 and borderId 0 — indices into tables that have to exist. Leaving
     them out produced a file Excel refused: opening it raised the "we found a
     problem with some content" repair prompt and silently rebuilt the styles on
     the way in. Index 0 is always "no fill" and "no border"; index 1 is the
     grey125 that Excel itself writes and expects to find.

     The caller's tints are appended to `fills`, which makes their fillIds
     2 and up, and each gets a matching <xf> at the same offset in `cellXfs` so
     a cell can point at it. A solid fill takes its colour from `fgColor`; the
     `bgColor` of indexed 64 is what Excel itself writes and is what it expects
     to find behind a solid fill. `applyFill` is required — without it Excel is
     free to ignore the fillId. */
  const fills = tintNames
    .map((name) => `<fill><patternFill patternType="solid"><fgColor rgb="${tints[name]}"/><bgColor indexed="64"/></patternFill></fill>`)
    .join('');

  const tintXfs = tintNames
    .map((_name, index) => `<xf numFmtId="0" fontId="0" fillId="${2 + index}" borderId="0" xfId="0" applyFill="1"/>`)
    .join('');

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="${2 + tintNames.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2 + tintNames.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>${tintXfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

  const entries = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ];

  return zip(entries);
}
