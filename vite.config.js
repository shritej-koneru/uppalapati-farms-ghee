import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        checkout: resolve(process.cwd(), 'checkout.html'),
        product: resolve(process.cwd(), 'product.html'),
        about: resolve(process.cwd(), 'about.html'),
        faq: resolve(process.cwd(), 'faq.html'),
        contact: resolve(process.cwd(), 'contact.html'),
        compliance: resolve(process.cwd(), 'compliance.html'),
      },
    },
  },
});
