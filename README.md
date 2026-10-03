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
  admin.js          Owner order book: sign-in, order list, export, decrypt.
  seal.js           Password-protects an export in the browser (PBKDF2 + AES-GCM).
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
npm run lint      ESLint over src/ and functions/
npm run typecheck node --check over every module in src/ and functions/
npm run check     lint + typecheck
npm run deploy    build, then publish dist/ to Cloudflare Pages
```

`functions/` is in both checks deliberately. It runs on Workers rather than in a
browser, so nothing else in the toolchain parses it before deploy — a mangled
regular expression is valid JavaScript, just not the regular expression that was
written, and it would otherwise ship unnoticed.

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

### Password-protecting the export

The downloaded sheet contains names, phone numbers and addresses, and it will end
up in a Downloads folder or attached to an email. So it is encrypted in the
**browser** before it touches the disk:

```
passphrase --PBKDF2-SHA-256 (600k)--> wrapping key
random 256-bit data key --AES-GCM(wrapping key)--> wrapped key
workbook bytes --AES-GCM(data key)--> ciphertext
```

Only the wrapped key is stored, so the file is safe even if the passphrase is
weak. The passphrase never reaches the server and there is no copy to recover.

**This is not an `.xlsx` that Excel prompts for.** That requires writing an
encrypted OLE2 compound file, which needs libraries a Worker cannot run and
cannot be validated without Excel to hand — an unverifiable security control is
worse than an honest one. The artefact is `uppalapati-orders-<date>.xlsx.enc`, and
the decrypt panel on `/admin` turns it back into a normal workbook.

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