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
        HTMLDialogElement: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
];
