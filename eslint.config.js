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
        /* Added with the order book. Seal.js encrypts the export with WebCrypto
           and admin.js fetches it; without these the lint failed on globals the
           browser has provided all along. Listed explicitly rather than pulling
           in the `globals` package, which is only present transitively via
           eslint and could be hoisted away by a dependency change. */
        crypto: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly'
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
  }
];
