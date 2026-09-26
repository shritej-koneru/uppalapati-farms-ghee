import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        checkout: resolve(process.cwd(), 'checkout.html'),
      },
    },
  },
});
