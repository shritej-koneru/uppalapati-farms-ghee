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
  bottles.js        Bottle/jar sizing data for the product render.
  product.js        Product detail page gallery.
  contact.js        Contact form.
  checkout.js       Checkout page.
  jar3d.js          three.js scene for the GLB jar.
  assets/
    logo-source.png Original artwork, 1254x1254. Source only — never deployed.

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
npm run lint      ESLint over src/
npm run typecheck node --check over each entry module
npm run check     lint + typecheck
npm run deploy    build, then publish dist/ to Cloudflare Pages
```

## Deploying

Pushing to `main` deploys automatically. The GitHub Actions workflow at
`.github/workflows/deploy.yml` builds and publishes to Cloudflare Pages, so
`https://ghee-client-2au.pages.dev` always reflects the latest commit.

The workflow authenticates with two repository secrets, both set on
`shritej-koneru/ghee-client`:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `ab3aa5a41145b440d32ea33c2d886d5e` |
| `CLOUDFLARE_API_TOKEN` | a User API Token with **Cloudflare Pages: Edit** and **Account Settings: Read**, scoped to Lolgamer12121245555@gmail.com's Account |

Both permissions are required. `Cloudflare Pages: Edit` alone fails with
`code: 10000`, because wrangler reads the account record before it uploads.

To publish by hand instead, use `npm run deploy`, which runs
`wrangler pages deploy dist --project-name=ghee-client --branch=main`.
`--branch=main` is what makes it a Production deployment, so the main domain
updates; without it the upload becomes a preview deployment on a unique
subdomain and the main domain is untouched.

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