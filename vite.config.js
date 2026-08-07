import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
// Vitest config is inlined here so we don't need a separate vitest.config.js

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.png'],
      manifest: {
        name: 'Dhanam Workspace',
        short_name: 'Dhanam',
        description: 'Diary, tasks, and collaboration in one place.',
        theme_color: '#7c3aed',
        background_color: '#f5f3ff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: '/icons/icon-32.png',           sizes: '32x32',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-72.png',           sizes: '72x72',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-180.png',          sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Never answer /__/* from the SPA navigation fallback. /__/ is
        // Firebase's reserved namespace — /__/auth/* is the sign-in handler,
        // proxied by nginx. The service worker would otherwise return cached
        // index.html for it, so the sign-in popup renders this app instead of
        // the handler and the handshake never completes (2026-08-05 incident:
        // two windows, no login). Required for authDomain = diary.dhanamfinance.com.
        navigateFallbackDenylist: [/^\/__\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'gstatic-fonts-cache', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
          }
        ]
      }
    })
  ],
  server: { host: true, port: 3000 },
  build: { outDir: 'dist', sourcemap: false, emptyOutDir: false },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
    setupFiles: [],
  },
});
