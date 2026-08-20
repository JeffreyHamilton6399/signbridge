import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Provided by vite-plugin-pwa at build time; the plugin does not run
      // under vitest, so src/pwa.ts gets a stub instead.
      'virtual:pwa-register': fileURLToPath(
        new URL('./tests/stubs/pwa-register.ts', import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
