import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        matchMedia: 'readonly',
        IntersectionObserver: 'readonly',
        ResizeObserver: 'readonly',
        performance: 'readonly',
        Image: 'readonly',
        FormData: 'readonly',
        CustomEvent: 'readonly',
        URLSearchParams: 'readonly',
        HTMLAnchorElement: 'readonly',
        HTMLDialogElement: 'readonly',
        /* Added with the order book, which brought in globals the browser has
           always provided but the config had not listed: checkout.js mints an
           idempotency key with crypto.randomUUID and admin.js turns the fetched
           sheet into a file with Blob and URL.createObjectURL. Listed explicitly
           rather than pulling in the `globals` package, which is only present
           transitively via eslint and could be hoisted away by a dependency
           change. */
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        /* herd.js reads the track's own transition duration out of the
           stylesheet rather than keeping a copy of it as a number, so that
           changing the movement in the CSS cannot leave the carousel waiting a
           different length of time than the movement actually takes. */
        getComputedStyle: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    /* The Pages Functions in functions/ run on the Workers runtime, not in a
       browser, and they used to be outside every check. A mistake in the order
       endpoint — a typo, an unused import, a reference to something that only
       exists on the client — would then pass `npm run check` and fail only once
       deployed. The globals differ too: no document or window here, but there is
       a `caches` default export. */
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        crypto: 'readonly',
        console: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        Headers: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  {
    /* The tooling in scripts/ runs under Node, so it needs the Node globals
       rather than the browser or Workers ones above. check-xlsx.mjs reads the
       generated sheet back out of the archive with TextDecoder, which is why
       that is listed alongside process. check-order.mjs builds a checkout body
       per assertion and gives each one a fresh idempotency key with
       crypto.randomUUID — the same generator the real form uses, so the check
       is exercising the actual shape rather than a stand-in. */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        URL: 'readonly',
        crypto: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
];
