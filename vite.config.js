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
        /* The owner's order book. The page itself is public — it is only a login
           form — but every order it can show comes from an endpoint that refuses
           an unsigned-in caller, so there is nothing here to protect. It is
           deliberately not linked from any navigation or sitemap: nobody
           stumble onto it, and no search engine indexes the login form. */
        admin: resolve(process.cwd(), 'admin.html'),
      },
    },
  },
});
