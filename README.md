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
  order-status.js    The five order statuses, shared by BOTH the order table and the
                    order endpoint for the same reason pricing.js is: the dropdown
                    the owner clicks and the check the server applies have to
                    agree, or a status gets offered that is then refused.
  bottles.js        Bottle/jar sizing data for the product render.
  product.js        Product detail page gallery.
  contact.js        Contact form.
  checkout.js       Checkout page.
  jar3d.js          three.js scene for the GLB jar.
  assets/
    logo-source.png Original artwork, 1254x1254. Source only — never deployed.

functions/          Cloudflare Pages Functions, deployed with the static site.
  api/orders.js     POST places an order (public). GET reads the order book, and
                    ?format=xlsx returns the workbook (signed-in owner only).
  api/session.js    POST sign in, DELETE sign out, GET session state.
  _lib/orders.js    Order validation and storage.
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
npm run check:xlsx Check the order sheet's structure and shape
npm run check     lint + typecheck + check:xlsx
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
to the same length as `toSheetRow` — see [Order status](#order-status).

For the one thing it cannot do, there is a check that uses the real thing:

```
powershell -File scripts/verify-xlsx.ps1 -Path scripts/tmp-status.xlsx
```

Opens a workbook in Excel with `CorruptLoad = 0` (xlNormalLoad) and prints the
used range, the header row and the first data row. Excel raises on a damaged file
under that flag rather than silently repairing it into something usable, so a
clean open is real evidence rather than a re-saved approximation. It needs Excel
installed, so it is a local tool and not part of `npm run check`.

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
Order references (`UP-2026-0001`) come from an atomic counter, incremented
*before* the insert so a reference is never reused, and each checkout attempt
carries a `request_key` so a double-tap or a retry cannot double-order.

A filled honeypot field does **not** drop the order — it records it with
`flagged = 1`. Password managers and autofill do sometimes write into hidden
inputs, and silently discarding what a customer believed they had ordered is far
worse than one junk row the owner can sort out.

### Order status

Every order carries one of five statuses — **pending**, **contacted**, **on the
way**, **completed**, **canceled** — set from a dropdown in the first column of
the order table. The list lives in `src/order-status.js` and is shared by the
Worker and the page for the same reason `pricing.js` is: the dropdown the owner
clicks and the check the server applies have to agree, or a status gets offered
that is then refused.

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

`npm run check` guards the two things that would quietly corrupt it: that the
header row and the data rows stay the same length, and that `Status` is still the
first column. Nothing rejects a mismatch at runtime — the sheet still opens, it
just slides one order's status under the next customer's name.

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
| **Reset the order book** | Deletes every order and sets the counter to zero |

The reset workflow takes no inputs beyond its confirmation. Its two SQL statements
are written out in the workflow file rather than taken as an input, because the
workflow holds the deploy's API token and a free-text SQL box would let anyone who
can dispatch a workflow run arbitrary statements against the live order book. It
records every order it is about to delete before deleting it, and then fails
unless both the row count and the counter are zero — checked with `grep` against
wrangler's JSON rather than by parsing it, so a change in that output shape cannot
quietly turn the check into a no-op that always passes. `login_attempts` is left
alone deliberately.

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