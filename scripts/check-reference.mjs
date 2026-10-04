/* ---------- The order reference ----------

   `nextReference` decides what the customer reads out over the phone and what the
   owner quotes back, so the two things it gets wrong quietly are the day being
   off by one and the sequence restarting in the middle of a day. Both are pure
   arithmetic on a date, which means both can be tested without a database.

   `now` is a parameter rather than a direct call to the clock for the same reason
   every other boundary here takes its input: a test that can only be run at the
   right moment of the day is a test that is not run. */

import { nextReference, isReference, IST_OFFSET_MS } from '../functions/_lib/orders.js';

/* Stands in for the D1 binding. The upsert is exercised for real against a local
   database by scripts/test-reference-counter.sql; this only needs to answer the
   question nextReference actually asks of it — give me the number this statement
   produced — so the value is returned rather than stored. */
function stubD1(counterNames) {
  const seen = new Map();
  return {
    env: {
      GHEE_ORDERS: {
        prepare: (sql) => {
          if (!sql.includes('ON CONFLICT')) throw new Error('expected the single-statement upsert');
          return {
            bind: (key) => ({
              first: async () => {
                const next = (seen.get(key) ?? 0) + 1;
                seen.set(key, next);
                counterNames.push(key);
                return { value: next };
              },
            }),
          };
        },
      },
    },
    seen,
  };
}

function check(ok, label) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures += 1;
}

let failures = 0;

console.log('\nThe day in the reference is the farm\'s day, not the server\'s');
{
  /* IST is UTC+5:30, so the last half hour of a UTC day is already the next
     morning in Guntur. Numbering an order placed at 00:15 IST against the UTC
     date would file it under yesterday and put it at the end of yesterday's
     sequence rather than the start of today's. */
  const cases = [
    ['2026-10-04T05:00:00Z', '041026', '10:30 IST, comfortably inside the UTC day'],
    ['2026-10-04T18:29:59Z', '041026', '23:59:59 IST, the last second of the UTC day'],
    ['2026-10-04T18:30:00Z', '051026', '00:00:00 IST — already tomorrow at home'],
    ['2026-10-04T18:45:00Z', '051026', '00:15 IST, the window that catches a naive date'],
    ['2026-12-31T18:30:00Z', '010127', 'midnight IST on New Year, so the year rolls too'],
    ['2026-01-01T04:00:00Z', '010126', '09:30 IST on 1 January'],
    ['2026-03-01T19:00:00Z', '020326', '00:30 IST the day after a short month'],
  ];

  for (const [iso, expected, why] of cases) {
    const names = [];
    const { env } = stubD1(names);
    const reference = await nextReference(env, new Date(iso));
    check(reference === `${expected}-001`, `${iso} -> ${reference}  (${why})`);
  }
}

console.log('\nThe sequence restarts each day');
{
  const names = [];
  const { env } = stubD1(names);

  const first = await nextReference(env, new Date('2026-10-04T12:00:00Z'));
  const second = await nextReference(env, new Date('2026-10-04T13:00:00Z'));
  const third = await nextReference(env, new Date('2026-10-04T14:00:00Z'));
  check(first === '041026-001', `the first order of the day is ${first}`);
  check(second === '041026-002', `the second is ${second}`);
  check(third === '041026-003', `the third is ${third}`);

  const nextDay = await nextReference(env, new Date('2026-10-05T06:00:00Z'));
  check(nextDay === '051026-001', `the first order of the next day is ${nextDay}, not a continuation`);

  check(
    new Set(names).size === 2,
    `one counter row per day, not one per order (rows touched: ${new Set(names).size})`,
  );
  check(
    names.every((name) => /^order-\d{6}$/.test(name)),
    `every counter is named for its day (${names[0]}, ${names[names.length - 1]})`,
  );
}

console.log('\nThe day part is read, not guessed');
{
  /* Three digits, and four if a day ever somehow runs to a thousand orders. Not a
     cap: truncating would hand two customers the same reference. */
  const names = [];
  const { env } = stubD1(names);
  const reference = await nextReference(env, new Date('2026-10-04T12:00:00Z'));
  check(/^041026-\d{3,}$/.test(reference), `${reference} is a day and at least three digits`);
}

console.log('\nisReference accepts what nextReference makes, and nothing else');
{
  const good = ['041026-001', '051026-001', '010127-999', '041026-1000'];
  const bad = [
    '',
    '41026001',
    '041026',
    '041026-01',
    'UP-2026-0001',
    '041026-001 ',
    ' 041026-001',
    '041026-001; DROP TABLE orders',
    '041026-00a',
    '041026_001',
  ];

  for (const value of good) check(isReference(value), `accepts ${JSON.stringify(value)}`);
  for (const value of bad) check(!isReference(value), `refuses ${JSON.stringify(value)}`);
}

console.log('\nThe offset is the one India uses');
check(IST_OFFSET_MS === 19_800_000, `IST is UTC+5:30 (${IST_OFFSET_MS}ms)`);

console.log(failures === 0 ? '\nThe order reference checks out.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);