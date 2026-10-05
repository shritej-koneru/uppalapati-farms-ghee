# Uppalapati Farms — storefront

Small-batch ghee storefront. Vite multi-page build, deployed to Cloudflare Pages.

## Layout

```
index.html  product.html  about.html  faq.html      Page entry points. These live at the
checkout.html  contact.html  compliance.html        repo root on purpose: Vite resolves
                                                  build inputs from the root, and the
                                                  paths are declared explicitly in
                                                  vite.config.js. Moving them into src/
                                                  would mean editing that config for no gain.

src/
  styles.css        All styling, one file. Loaded directly by each page as
                    /src/styles.css and processed by Vite.
  main.js           Homepage: scroll journey, scroll-scrubbed film, Lenis, 3D jar.
  site.js           Header, mobile menu, cart badge. Shared by every page.
  business.js       Business details: phone, FSSAI number, certificate path.
  catalogue.js      Products, sizes and prices. Single source of truth shared by the
                    cart, the product page and checkout so they cannot disagree.
  pricing.js        Prices, names, sizes, preorder flags and delivery-date rules,
                    imported by BOTH the storefront and the order endpoint so the
                    figure quoted to a customer and the figure recorded by the
                    server cannot drift apart. catalogue.js layers presentation on
                    top of it, and cannot be imported by the Worker because it
                    touches window/localStorage.
  admin.js          Owner order book: sign-in, order list, per-order status picker,
                    Excel download.
  order-status.js    The five order statuses, and the colour each one is filled
                      with in the exported sheet. Shared by BOTH the order table
                      and the order endpoint for the same reason pricing.js is: the
                      dropdown the owner clicks, the check the server applies and
                      the cell the owner scans all have to agree, or a status gets
                      offered that is then refused.
  bottles.js        Bottle/jar sizing data for the product render.
  product.js        Product detail page gallery.
  contact.js        Contact form.
  checkout.js       Checkout page, and the modal receipt shown once an order is
                    recorded - see [The receipt](#the-receipt).
  barcode.js        Code 128 encoder for the receipt's barcode. A real standard,
                    not decoration - see [The receipt](#the-receipt).
  jar3d.js          three.js scene for the GLB jar.
  herd.js           The herd carousel in the farm page hero. Loaded by about.html
                    only - see [The herd carousel](#the-herd-carousel).
  assets/
    logo-source.png Original artwork, 1254x1254. Source only — never deployed.

functions/          Cloudflare Pages Functions, deployed with the static site.
  api/orders.js     POST places an order (public). GET reads the order book, and
                    ?format=xlsx returns the workbook (signed-in owner only).
  api/session.js    POST sign in, DELETE sign out, GET session state.
  _lib/orders.js    Order validation, storage and the reference counter. Also owns
                    IST_OFFSET_MS, which both the reference and the sheet's "Placed
                    (IST)" column read, so the two can never disagree on the day.
  _lib/session.js   Passphrase check, signed cookie, sign-in throttle.
  _lib/xlsx.js      Minimal .xlsx (ZIP + XML) writer. No dependencies.
  _lib/http.js      Response helpers and client address handling.

db/schema.sql       The full order schema. Idempotent, so it is safe to re-run
                    against the live database to add anything missing.
db/migrations/      Changes to a table that already exists. Editing schema.sql
                    alone does nothing to an existing database — CREATE TABLE IF
                    NOT EXISTS is a no-op on a table that is already there — so a
                    migration is what actually brings the live database up to the
                    same shape. Numbered, and one file per change.

wrangler.toml       Project name, build output directory, D1 binding. Read by
                    `wrangler pages deploy`, which is why the deploy script
                    passes no arguments — one place decides where the site goes.

public/             Copied verbatim into the build. Not processed or fingerprinted.
  _headers          Cloudflare Pages headers: immutable caching for /assets,
                    Accept-Ranges on /media (without it the scroll-scrubbed film
                    is not seekable).
  media/            Everything served at /media/*.

dist/               Build output. Gitignored.
```

Two rules that matter when adding files:

- **Referenced assets belong in `public/media/`.** Anything there is served at
  `/media/<name>` exactly as written, and is not hashed. Only put things there
  whose URL must stay stable.
- **Import JS and CSS from `src/`.** Vite bundles and fingerprints those, so they
  get immutable cache headers.

Asset URLs are always literal strings. There is no dynamic path construction, so
an asset that nothing references is dead weight shipped on every deploy. After
adding or removing media, check it is actually referenced before committing.

## Commands

```
npm run dev       Vite dev server on 0.0.0.0
npm run build     Production build into dist/
npm run preview   Serve the built dist/
npm run lint      ESLint over src/, functions/ and scripts/
npm run typecheck node --check over every module in src/ and functions/
npm run check:xlsx Check the order sheet's structure, shape and status fills
npm run check:reference Check the order reference format and its date handling
npm run check:order Check what the checkout will and will not accept
npm run check:barcode Check the receipt barcode encodes and decodes the reference
npm run check     lint + typecheck + all four checks
npm run deploy    build, then publish dist/ to Cloudflare Pages
```

`functions/` is in both checks deliberately. It runs on Workers rather than in a
browser, so nothing else in the toolchain parses it before deploy — a mangled
regular expression is valid JavaScript, just not the regular expression that was
written, and it would otherwise ship unnoticed. `scripts/` is in there for the
same reason: the checks are only worth anything if they are run.

`check:xlsx` builds a workbook and reads the zip back, with no Excel and no
network. It asserts the parts Excel requires exist, that the content types and
relationships agree with what was written, that every style index resolves into a
table that is actually present, that the declared dimension matches the rows and
columns there, and that `Total` is numeric. It also holds the real `SHEET_COLUMNS`
to the same length as `toSheetRow`, and asserts the Status cell of every status
carries that status's own fill — through the real `SHEET_TINTS` the endpoint
passes, so a change to the export's configuration fails the check rather than
quietly producing a white Status column — see [Order status](#order-status).

`check:reference` and `check:order` cover the two pure functions on the order
path that have no database behind them: which day and which number a new order
gets, and which customer input is accepted. Both take the clock as an argument so
they can be run at any moment — a check that only passes at 10am is a check that
is not run.

`check:barcode` is the one that earns its own place, because the barcode it guards
is the only part of the shop that can look right and still be wrong. The component
it replaced drew its bars from `Math.sin(seed + index)` — a seeded random number
generator picking a width — which looks exactly like a barcode and decodes to
nothing. No test that checks the bars are the right colour would ever have caught
that, so this one encodes the reference, reads the module widths back with a
decoder in the opposite direction, and insists the reference comes out again. The
encoder and the decoder are the same file and could agree on something wrong, so
both are pinned to the standard's own published worked example instead: "Wikipedia"
in set B, whose width sequence and modulo-103 checksum are written out in full in
the check. It also flips each module in turn and asserts no single-bit corruption
decodes to the same order — a barcode that silently misreads as a different order
number is worse than one that fails outright.

For the one thing they cannot do, there is a check that uses the real thing:

```
powershell -File scripts/verify-xlsx.ps1 -Path scripts/tmp-status.xlsx
```

Opens a workbook in Excel with `CorruptLoad = 0` (xlNormalLoad) and prints the
used range, the header row and the first data row. Excel raises on a damaged file
under that flag rather than silently repairing it into something usable, so a
clean open is real evidence rather than a re-saved approximation. It also reads
back the interior colour of every Status cell and compares it against
`STATUS_FILLS` read out of `src/order-status.js` at run time — a well-formed sheet
whose fill index Excel ignores looks perfect to everything that is not Excel. It
needs Excel installed, so it is a local tool and not part of `npm run check`.

## Orders

A customer submits the checkout form, the order is written to D1, and the owner
reads it at **`/admin`** — a page that is not linked from anywhere.

### Why a database and not a spreadsheet

An `.xlsx` file is a zip archive that cannot be appended to. Adding a row means
rewriting the whole file, so two orders arriving together race and one is lost
silently. Orders are therefore recorded in D1, and the workbook is generated on
demand when the owner asks for it.

The client sends a cart, never a price. The server recomputes every total from
`src/pricing.js`, so a tampered or stale price cannot change what is recorded.
Order references (`041026-005`) come from an atomic counter, incremented
*before* the insert so a reference is never reused, and each checkout attempt
carries a `request_key` so a double-tap or a retry cannot double-order.

A filled honeypot field does **not** drop the order — it records it with
`flagged = 1`. Password managers and autofill do sometimes write into hidden
inputs, and silently discarding what a customer believed they had ordered is far
worse than one junk row the owner can sort out.

### The receipt

The moment an order is recorded, `/checkout` opens a modal **ticket** carrying the
order number, the amount to pay, the time it was placed, the WhatsApp number we
will message, a barcode of that order number, and the fact that nothing has been
charged. There is a **Print / save as PDF** button and a **Close** button, and the
card says outright that a screenshot works just as well.

It is a tear-off stub — notched edges, dashed perforation rules, a barcode — because
that is what a customer is going to treat it as: the slip they keep and the stub
they read our number off. The notches and the dashed rules are not decoration
either, they say *this is detachable* in a way a plain rounded panel does not.

It is a modal because those things are what the customer cannot get back once the
page is closed, and a banner at the bottom of a scrolled form is exactly where
that information goes to be missed. It is **light where the shop is dark**, which is
not decoration: the card is going to be photographed off a phone screen and read out
over a call, and near-black text on cream survives both a camera and a print far
better than cream text on near-black.

A native `<dialog>` rather than a div with a class. Everything a modal has to get
right — trapping focus inside it, making the rest of the page inert, Escape to
dismiss, stacking above the header — is behaviour the browser already implements
correctly, and every one of those is something hand-rolled modals get subtly
wrong. Two consequences are deliberate:

- **Clicking the backdrop does not close it.** Losing the order number to a
  stray click is precisely what the receipt exists to prevent, and a native dialog
  does not close on a backdrop click, so there is nothing to add.
- **Focus lands on the card rather than on the first button**, so the order number
  is what a screen reader announces, and Tab reaches the buttons next.

The dialog is a flex column, so the card scrolls and the buttons do not move. On a
360x640 phone the ticket is taller than the screen; without this the Print and
Close buttons would fall below the fold with nothing to scroll them into view, which
would make the one card the customer is told to keep unreachable on exactly the
devices most likely to photograph it. The notches are siblings of the scrolling
area rather than children of it — inside a scroll container they would be 16px
wider than the card on each side, and the ticket would scroll sideways.

**Print / save as PDF** calls `window.print()`. The browser's own print dialog is
where "Save as PDF" already lives, on every platform, and it lets the customer
print to paper just as easily — a button that silently produced a download would
be less capable, not more. The `@media print` block hides everything that is not
the card and takes it out of the top layer, because a modal is `position: fixed`
and in print that lands it on page one regardless of where the reader is. Three
things are dropped, each for a different reason: the buttons and the screenshot
hint are instructions for a screen; the confetti is an animation that will not have
finished; and the notches are painted in the backdrop's colour to look like holes
through the card, so on white paper they would print as two dark discs stuck to
the edge.

The cart is emptied and the checkout is re-rendered behind the modal, so closing it
leaves an empty cart and focus on the link back to the shop — not on a submit
button that no longer exists.

#### What the ticket does not say

The design this ticket came from was a **payment** receipt: card network mark,
cardholder name, the last four digits of the card, an amount in dollars. Every one
of those would be a lie here, because this shop takes no payment — the money
changes hands on a WhatsApp chat after we have agreed the order with the customer.
A card number printed on a receipt tells the customer their card was read, and it
would be read as a charge that had not happened. So the payment row is the WhatsApp
number, in the same slot, because that is the real next step; the amount is the
recorded total in rupees; and the sub-line under "Thank you!" says plainly that
nothing has been charged.

The amount is quoted from **what the server recorded**, not recomputed by the page.
`POST /api/orders` returns the stored `total` and `item_summary` alongside the
reference — including on the duplicate path, so a customer who double-taps submit
gets the same figures twice rather than a second ticket with a different number.

#### The barcode

Real **Code 128**, encoding the order reference, so a scanner on a printed or
screenshotted receipt reads back the same number the owner will match against the
order book. The component it replaced drew its bars from a seeded random number
generator, which looks exactly like a barcode and decodes to nothing — decoration
posing as data. `src/barcode.js` carries the standard's 107 width patterns, the
modulo-103 checksum, and set B's `codePoint - 32` mapping. It refuses anything
outside printable ASCII rather than drawing the wrong character.

Set B alone, not the set C digit-packing optimisation. Set C would make a
ten-character reference about a third shorter, which on a card that already fits is
worth nothing, and it costs a second path through the checksum plus two switch codes
to get wrong. Correctness is the entire point of having a barcode.

It is generated as an SVG string and injected, `aria-hidden`, because the reference
is already set in text directly above it. Bars are never thinner than one device
pixel — a sub-pixel bar can be dropped entirely by the rasteriser, which quietly
turns a scannable barcode into a stripey one that only looks like it works — and
both ends carry the ten-module quiet zone a scanner needs to find the first bar.
`npm run check:barcode` round-trips it and pins it to the standard; see
[Commands](#commands).

#### The confetti

A hundred pieces behind the card for about seven seconds, then removed. `pointer-events:
none`, so it can never intercept the click on Print. Built once into a fragment and
emptied on a timer rather than re-randomised per frame, which is what the original
did — it called `Math.random()` inside its render, so every re-render slid all
hundred pieces to a new place mid-fall. Nothing is built at all under
`prefers-reduced-motion`, and the card's own arrival animation is off there too.

### The order reference

`041026-005` is **the day the order was placed, in the farm's own timezone,
followed by the order number within that day**. It reads out as "the fourth of
October 2026, fifth order", which is the sentence a customer and the owner will
actually have when one of them rings the other about a jar.

The date is IST because a Worker has no timezone of its own and a server date
would file an order placed at 00:15 IST under yesterday — putting it at the end of
yesterday's sequence instead of the start of today's. India has had no daylight
saving since 1945, so a fixed +5:30 offset is exact rather than an approximation,
and it is defined once in `functions/_lib/orders.js` because the date an order is
numbered against and the time printed on the sheet have to come from the same
clock.

The counter is one row per day — `order-041026` — rather than one counter, so
`005` means the fifth order *today*, which is the number the owner saw that day.
The day is part of the reference, so `041026-001` and `051026-001` cannot collide
and the restart each morning costs nothing. The rows are never removed; the table
grows by one a day against a database holding the entire order book. The reset
workflow clears them. `check:reference` pins the day arithmetic, the daily restart
and the shape of the value itself.

The sequence is written by a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`
statement rather than an `UPDATE` followed by an `INSERT`. As two statements there
is a window in which two orders arriving together both fail to find the row and
both insert — and `name` is the primary key, so the second throws and the customer
is told their order was not recorded when it very nearly was.

### Order status

Every order carries one of five statuses — **pending**, **contacted**, **on the
way**, **completed**, **canceled** — set from a dropdown in the first column of
the order table. The list lives in `src/order-status.js` and is shared by the
Worker and the page for the same reason `pricing.js` is: the dropdown the owner
clicks, the check the server applies and the cell the owner scans all have to
agree, or a status gets offered that is then refused.

An order arrives as `pending`. Nobody has confirmed anything at that point — the
customer pressed a button and the owner has not replied. The list is ordered as
the work happens rather than alphabetically, so the dropdown reads as the next
step to take; `canceled` is the way out rather than a stage, so it sits last.

Moving an order is `PATCH /api/orders` with `{ reference, status }`, behind the
same session as every read. An unknown status is refused with 422, a reference
that does not exist with 404, and the update is matched on the primary key, so a
crafted reference cannot reach another order's row. There is no `CHECK`
constraint on the column: the list in code is the gate, and a database-level
refusal would surface as an error nobody could act on.

The dropdown only shows a status the server has confirmed. `data-status` on the
wrapper drives the colour, and it is written from the server's answer rather than
from the selection, so a save that fails leaves the picker showing the status the
order is actually in — with the reason beside it. Choosing a status never
refetches the table, which would close any row the owner has open and pull the
dropdown out from under the pointer they are still using.

The summary line counts **still to deliver**: every order that is neither
completed nor canceled, so it includes the ones already contacted and already on
the road.

### The Excel export

`/api/orders?format=xlsx` builds a fresh single-sheet workbook on request and
returns it as `uppalapati-orders-<date>.xlsx`. **Status leads**, then reference,
the moment the order was placed (both UTC and IST, since the farm reads its own
clock), the customer's name, mobile, a WhatsApp-ready `91…` number, email, full
address, delivery date, items, total, and the preorder/flagged housekeeping marks.
The sheet carries the label rather than the stored value, so filtering and
sorting in Excel read "On the way" instead of `on-the-way`. Totals are written as
numbers so Excel can add up a column.

Each Status cell is filled with its status's colour. `SHEET_TINTS` says which
column is the state of the order and what colour each status is; the writer itself
knows nothing about statuses, so the shop's list stays in one file with everything
else about status.

Those fills are much paler than the pills on the order table. A spreadsheet is
read in a column and is often printed, where the saturated web colours would read
as five loud bands and waste a cartridge. They are tints of the same hues, all
above 17:1 against the default black text, so the cell is unmistakable and still
legible in greyscale or for a colour-blind reader — the word in the cell carries
the meaning either way, the colour only saves the owner scanning for "which of
these are still to go". A status the table does not recognise is left white rather
than given a colour that would claim to be a state it is not.

`npm run check` guards the three things that would quietly corrupt it: that the
header row and the data rows stay the same length, that `Status` is still the
first column, and that every status reaches its cell with its own fill. The last
one runs through the real `SHEET_TINTS` the endpoint passes, so a change to the
export's configuration fails the check rather than quietly producing a white
Status column. Nothing rejects a mismatch at runtime — the sheet still opens, it
just slides one order's status under the next customer's name.

`scripts/verify-xlsx.ps1` covers what a ZIP-and-XML reader cannot: it opens the
file in Excel and reads the fill back out of the cell.

The file is **not** encrypted. The owner passphrase guards the `/admin` page and
every read of the order book, and the export is only reachable behind that
session, so a sheet never travels by link and nobody without the passphrase can
start a download. Once it is on disk it is an ordinary spreadsheet — keep it
accordingly.

### Owner secrets

Two Worker secrets, set with `wrangler pages secret put` and never committed:

| Secret | Value |
| --- | --- |
| `ORDER_ADMIN_PASSPHRASE_HASH` | SHA-256 hex digest of the owner passphrase |
| `ORDER_SESSION_SECRET` | 32 random bytes, base64url. Signs the session cookie |

Generate them with:

```
node -e "console.log(require('crypto').createHash('sha256').update('YOUR-PASSPHRASE').digest('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Only the digest is stored, never the passphrase — so **the owner must keep the
passphrase somewhere safe**. There is no reset path, and no way for anyone,
including Cloudflare, to recover it. Copy `.dev.vars.example` to `.dev.vars` for
local work; it is gitignored.

Sign-in allows 8 failures per 15 minutes per address, counted in D1 against a
keyed hash of the address rather than the address itself. A wrong passphrase and
an exhausted allowance give different answers on purpose: the first is the
owner's own typo and must not lock them out of their own shop for a quarter of
an hour.

### Database

`ghee-orders` (`5bb0a8ee-c8ae-4499-b013-32dcf6b8ca1c`), bound as `GHEE_ORDERS`.
The schema lives in `db/schema.sql` and is idempotent, so the live database is
reproducible rather than being the only copy:

```
npx wrangler d1 execute ghee-orders --remote --file=db/schema.sql
```

`notified` already exists and is left at 0, so switching on order emails later is
not a migration.

**Changes to an existing table go in `db/migrations/`, not just in
`schema.sql`.** `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already
exists, so editing the `CREATE TABLE` only helps a fresh install; the migration is
what brings a live database up to the same shape. `0002-order-status.sql` adds
the `status` column the order table reads.

Apply one by hand with:

```
npx wrangler d1 execute ghee-orders --remote --file=db/migrations/0002-order-status.sql
```

or, on this machine, with the **Migrate the database** workflow — the local
wrangler login belongs to a different Cloudflare account, so `--remote` fails from
here and CI is the only context holding a token that can reach production.

**Order matters: migrate before deploying the code that needs the column.** A
deploy that reads `orders.status` against a database without it fails every
request, and the `INSERT` that places an order fails with it.

Two properties of that workflow are deliberate. It takes the *name* of a migration
file rather than SQL, because it holds the deploy's API token and a box taking
statements would let anyone who can dispatch a workflow run arbitrary SQL against
the live order book — a named, committed file is the same SQL, but reviewed code
sitting next to the schema it changes. And both inputs reach the shell through
`env:` rather than as `${{ }}` in a `run:` body, because a workflow input is
attacker-controlled by anyone who can dispatch and text pasted into a shell is
executed by it.

`0002` checks whether it has already been applied, which is what makes
re-dispatching it safe: SQLite cannot add a column only if it is missing, so the
`ALTER` errors every time after the first, and tolerating that error and hoping it
was the duplicate-column one is how a migration ends up reported as applied when it
was not. A later migration needs its own pre-check written for it before it is
listed as re-runnable.

## Deploying

Pushing to `main` deploys automatically. The GitHub Actions workflow at
`.github/workflows/deploy.yml` builds and publishes to Cloudflare Pages, so
`https://ghee-client-2au.pages.dev` always reflects the latest commit.

The workflow authenticates with two repository secrets, both set on
`shritej-koneru/ghee-client`:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `ab3aa5a41145b440d32ea33c2d886d5e` |
| `CLOUDFLARE_API_TOKEN` | a User API Token with **Cloudflare Pages: Edit**, **Account Settings: Read** and **D1: Edit**, scoped to Lolgamer12121245555@gmail.com's Account |

All three are required. `Cloudflare Pages: Edit` alone fails with `code: 10000`,
because wrangler reads the account record before it uploads, and `D1: Edit` is
needed to reach the order database.

`npm run check` runs before the build and gates the deploy. CI used to go
straight from `npm ci` to publishing, which is how a workbook Excel refused to open
reached production with nothing complaining on the way.

### If a deploy needs a migration

`deploy.yml` does not run migrations, and should not: a push to `main` deploys on
its own, so coupling the two would mean a schema change lands in production at
whatever moment someone happened to commit, with no check and no confirmation.

The sequence for a change that adds a column is:

1. Commit and push the migration on its own, as a separate commit ahead of the
   code that needs it.
2. Run **Migrate the database** and check it succeeded.
3. Commit and push the code.

The deploy for step 1 republishes the unchanged previous build, which is harmless.

### The two manual workflows

Both are `workflow_dispatch` only, both refuse unless their confirmation text
matches exactly, and both exist because the local wrangler login on this machine
belongs to a different Cloudflare account — so anything that has to reach the
production database has to go through CI, which holds a token that can.

| Workflow | What it does |
| --- | --- |
| **Migrate the database** | Applies one file from `db/migrations/` to production |
| **Reset the order book** | Deletes every order and every day's counter |

The reset workflow takes no inputs beyond its confirmation. Its two destructive SQL
statements are written out in the workflow file rather than taken as an input,
because the workflow holds the deploy's API token and a free-text SQL box would let
anyone who can dispatch a workflow run arbitrary statements against the live order
book. It records every order it is about to delete before deleting it, and then
fails unless both the row count and the counter count are zero — checked with `grep`
against wrangler's JSON rather than by parsing it, so a change in that output shape
cannot quietly turn the check into a no-op that always passes. `login_attempts` is
left alone deliberately.

It deletes **every** `order%` counter row rather than zeroing one. The sequence is
per day, so there is now one row per day rather than one row forever, and zeroing
the row that happens to match today would leave tomorrow's counter where it was and
hand out 004 as the first order of the morning.
`scripts/test-reset-workflow.sh` runs all three steps against the local database,
seeded with two days' counters, so this is tested rather than assumed.

> **Deploying with functions needs more than the CI token has.** The token
> above can build and publish the site, but setting Worker secrets requires
> **Workers Scripts: Edit**, which a CI token should not have. Manage
> `ORDER_ADMIN_PASSPHRASE_HASH` and `ORDER_SESSION_SECRET` by hand with
> `wrangler pages secret put` when they change; secrets live on the project, not
> in the deployment, so a normal deploy does not disturb them.

To publish by hand instead, use `npm run deploy`, which runs
`npm run build && wrangler pages deploy --branch=main`. The project name, output
directory and D1 binding all come from `wrangler.toml`, so the script passes no
other arguments. `--branch=main` is what makes it a Production deployment, so the
main domain updates; without it the upload becomes a preview deployment on a
unique subdomain and the main domain is untouched.

> **Careful when deploying locally.** Without `CLOUDFLARE_ACCOUNT_ID` set,
> wrangler falls back to the OAuth login in the user profile. If that login
> belongs to the *other* account, a manual deploy will silently publish to the
> old site instead of failing, because a project named `ghee-client` exists in
> both accounts. Set the account id first:
>
> ```
> set CLOUDFLARE_ACCOUNT_ID=ab3aa5a41145b440d32ea33c2d886d5e
> npm run deploy
> ```

To roll back, redeploy an earlier commit — Cloudflare Pages keeps every
deployment addressable by id under the dashboard's Deployments tab.

### A note on the subdomain

The project is named `ghee-client`, but its address is
**`ghee-client-2au.pages.dev`**, not `ghee-client.pages.dev`. Cloudflare assigns
a `pages.dev` subdomain when a Pages project is created, and does not allow it
to be changed afterwards. The plain `ghee-client` subdomain was taken at creation
time, so the `-2au` suffix is permanent for this project.

To get a cleaner address, attach a custom domain to the project (Project →
Custom domains). That is independent of the `pages.dev` subdomain and is the
supported way to run this site on a domain you own.

## Logo

`src/assets/logo-source.png` is the original artwork. The deployed files are
derived from it and must be regenerated whenever it changes:

| File | Size | Used for |
|---|---|---|
| `public/media/logo.png` | 200px, transparent | nav mark and loading screen |
| `public/media/favicon-32.png` | 32px, transparent | browser tab |
| `public/media/icon-512.png` | 512px, transparent | large icon, sharing |
| `public/media/apple-touch-icon.png` | 180px, transparent | iOS home screen |

The three icons are transparent, not flattened onto `--night`. iOS and Android
composite transparent icons onto black, which is close enough to `#080b09` that
the plate is invisible.

The nav mark scales 40px desktop / 32px below 700px. Both sizes are served from
the single 200px file, and it is preloaded in the page head so it does not pop in
after paint.

## The herd carousel

The farm page hero carries a carousel of four real photographs of the cows, in the
space that sat empty to the right of the heading. The originals are the client's own
camera files and are **not** in the repo; the four files below are the only copies,
so keep the source somewhere safe.

| File | Source | Shape |
|---|---|---|
| `public/media/farm-thirupati.jpg` | `Thirupati Amma and Calf.png` | 1200×900 |
| `public/media/farm-gowri.jpg` | `Gowri and Calf in the Barn.png` | 1200×1004 |
| `public/media/farm-laxmi.jpg` | `Laxmi Resting in the Cow Shed.png` | 1200×1200 |
| `public/media/farm-herd.jpg` | a WhatsApp photo, unnamed | 554×1200 |

Each was re-encoded to JPEG at quality 82 with EXIF stripped, longest edge 1200.
That took the four from 7.2 MB to 775 KB. They are ordinary photos with no source
artwork, so unlike the logo there is nothing to regenerate — replacing one means
dropping in a new file at the same path and keeping the `width`/`height`
attributes in step, because those are what reserve the space before the file
arrives.

The three source shapes are all different, so `.herd-carousel__slide` fixes the box
at 4:5 — the ratio the product photography already uses — and the image covers it.
That crops 40% off the width of the Thirupati shot and 42% off the height of the
tall one. If an animal's head ever ends up clipped, the fix is an `object-position`
on `.herd-carousel__slide img`, not a change to the frame.

### Why the heading cannot rewrap

The hero was already a single column with a wide empty right half. Adding the
carousel next to it looks like it must rewrap the text, but it does not, and the
reason is worth preserving before anyone "tidies" the CSS:

- The heading is `max-width: 16ch`, measured against **its own font size**, not
  against its container. So its line breaks are independent of the column width.
- The lead paragraph is `max-width: 54ch` and that one is *not* safe. It pins the
  text column at 556px and is what decides the stacking breakpoint.
- `.page-hero--split` therefore gives the text `minmax(0, 1fr)` and the carousel a
  fixed `clamp(240px, 24vw, 340px)`. A `1fr` carousel would grow without limit on a
  wide monitor, and since the frame is 4:5 that would make the hero taller and
  taller; the clamp means the hero reaches its final height by about a 1280px
  laptop and stops there.
- `.page-hero--split` is a **modifier**, because `.page-hero` is shared by five
  pages and the other four must stay single-column.

The hero stops being two columns at **1024px, not the 860px `.split` uses** —
because the binding constraint is the 54ch lead, not the 16ch heading. From about
1010px down there is no longer room for 556px of text plus a 240px carousel plus
the gap. Verified by diffing the rendered heading, lead, eyebrow, font sizes,
max-widths and all four paddings against production at 18 widths from 360px to
1920px: byte-identical at every one.

### Two things in here that are load-bearing

**`user-select: none` on `.herd-carousel__viewport`.** Without it a mouse
press-and-drag across a photograph selects the caption printed over it, and the
*next* press landing inside that selection starts a native drag-and-drop of the
selected text. Chromium answers that with `pointercancel`, so the second and every
later swipe with a mouse silently stopped moving the carousel for the rest of the
session. Measured: six consecutive 200px drags gave three that worked and three
cancelled with it off, six that worked with it on. `herd.js` also clears any
selection on `pointerdown`, which covers a range made elsewhere on the page.

**The carousel loops.** It did not at first: the arrows used to disable at both
ends, the autoplay used to stop at the last slide, and a drag past either end used
to meet 35% resistance. That was a deliberate call — a hero that silently jumps
from the last cow back to the first reads as disorienting — and the client asked
for the opposite, which is the right call for a hero that people watch rather
than read.

A finite track cannot loop by itself. There is nothing to stand to the right of the
last photograph, so slide 0 arriving would mean sliding the whole strip back across
the other three — four slides of travel for a one-slide step. So the track gets a
**spare copy at each end**: a copy of the last slide at the front and a copy of the
first at the back, and those two do the turning.

The copies are transient, and everything downstream is written in terms of the real
slides. The move runs onto a copy, and when it lands the track is put back onto the
real slide with the transition off — invisible, because a copy and its original are
the same picture in the same box. State (dots, announcement, autoplay, the loop
itself) never knows the difference, so a click landing inside that half second is
paid off first and the next step is taken from the real slide.

Two things about the copies are deliberate:

- Their images are `loading="eager"` with `fetchpriority="low"`. A copy is on screen
  the instant the loop uses it, and a lazy image would put a frame of empty
  background there. The URLs are the ones already being requested, so this is not
  extra weight, only earlier — and the low priority keeps either of them from
  competing with the photograph that decides how fast the page paints.
- They have `data-herd-slide` **removed**. `cloneNode` copies it, and leaving it on
  would quietly double the answer to any later
  `querySelectorAll('[data-herd-slide]')` — including this file's own, if it were
  ever run twice.

With the loop there are no ends, so **the arrows are never disabled** and the
`:disabled` rules are gone from the CSS. Dragging is the same everywhere now: the
loop can fill a whole slide of movement in either direction, and only an overshoot
past *that* is damped, so the track cannot run off into empty space.

The wait before the copy is swapped out is read out of the stylesheet with
`getComputedStyle`, not kept as a number in `herd.js`. That is not tidiness: the
wait is a backstop for the transition's own `transitionend`, so a constant that
drifted out of step with the CSS would not fail safely — a longer move than the code
expected would get its jump part-way through and be visibly cut short. Verified by
slowing the CSS to 3s and confirming the swap happens at ~3.1s rather than at the
660ms the old constant would have used.

### Behaviour

Pointer Events, not scroll position, because the brief was swipe on a phone *and*
drag on a laptop, and those are two different native behaviours — overflow
scrolling gives you the first for free but no mouse drag at all. `touch-action:
pan-y` keeps the vertical page scroll working while claiming the horizontal axis.

- Click a dot, click an arrow, drag, swipe, or use ← → Home End on the focusable
  viewport. Drag commits at 18% of the slide width. Every one of those routes
  loops, and a dot takes the short way round rather than the long one.
- Autoplays every 5.2s and loops, pausing on hover, on focus, during a drag, and
  while the tab is hidden. The hover check is `pointerType !== 'touch'`, because a
  finger fires `pointerenter` on touch-down and would otherwise stop the carousel
  the instant anyone swiped it.
- Under `prefers-reduced-motion: reduce` there is no autoplay and no transition.
- Without JavaScript it degrades to a scrollable strip of all four photographs
  with no controls — the controls are hidden in CSS until `herd.js` sets
  `data-herd-ready`, so a visitor never meets a dead arrow.

Captions are overlaid on the photograph behind a gradient scrim, so the contrast
comes from the panel rather than from the photo. Measured by compositing the
scrim over the actual pixels of all four images and taking the lightest pixel
found under each line of text: name 9.77–11.04:1, note 8.07–8.29:1, against a WCAG
AA requirement of 4.5:1.

`about.html` also carries the farm's location. It is a Google Maps short link,
which is worth knowing about before anyone assumes it is stable: short links can
be retired, and the URL will then land somewhere unhelpful rather than 404.