import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      workbox: {
        // MediaPipe .task files and ONNX weights are tens of MB. Precaching the
        // shell keeps first paint instant; the heavy model assets are cached on
        // first use instead so a cold install isn't a 30 MB download.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Without this, superseded precaches linger and disk use grows every deploy.
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/mediapipe\/.*\.(task|wasm|js)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'signbridge-vision',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/models\/.*\.(onnx|json)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'signbridge-models',
              expiration: { maxEntries: 32 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/clips\/.*\.(mp4|webm|json)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'signbridge-clips',
              expiration: { maxEntries: 400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'SignBridge — ASL recognition assistant',
        short_name: 'SignBridge',
        description:
          'On-device American Sign Language recognition assistant. Not an interpreter.',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer -> multi-threaded WASM in ORT/MediaPipe.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
