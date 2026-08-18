import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// Phase 34G — PWA support so the app loads on flaky / dead-zone
// connections (Gujarat field rep daily reality). Workbox precaches
// the build assets and the app shell; runtime caching handles
// Supabase reads + tiles. Push-notification handlers from the
// existing /public/sw.js are merged into the generated SW via the
// `injectManifest` strategy — keeps the Phase 33R/W push handlers
// intact while gaining offline shell.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest lets us keep our own /sw.js as the source of
      // truth (push handlers etc.) and ask Workbox to inject the
      // precache manifest into it. Avoids losing the push code.
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      injectManifest: {
        // Limit precache to the app shell; don't precache PDFs /
        // user-generated content.
        // Phase 34Z.24 — added `ttf` so the Roboto fonts used by the
        // PDF renderer survive offline AND don't get hidden behind
        // Workbox's navigation-fallback (which was serving index.html
        // for any request the SW couldn't match — silently breaking
        // the font fetch with HTML body).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf}'],
        // Bundled GSRTC pitch deck (public/deck/) — 8 MB of html/png/svg that
        // globPatterns would otherwise force onto every rep's phone precache.
        // Exclude it so the deck loads fresh from network (footage swaps show
        // immediately). Pairs with the /deck denylist in sw.js.
        globIgnores: ['deck/**'],
        // Skip enormous auto-generated bundles from the hard cap.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: 'Untitled OS — AdFlux',
        short_name: 'Untitled OS',
        description: 'Field-first sales + ops for Untitled Advertising, Vadodara.',
        theme_color: '#FFE600',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/work',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      devOptions: {
        enabled: false, // don't run SW in dev — confuses HMR
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Phase 317 — manualChunks pairs with the route code-splitting in App.jsx:
  // the heavy, page-specific libs each get their own cached chunk so they load
  // ONLY with the pages that import them (a rep never downloads reactflow, the
  // PDF stack, xlsx, or the map loader) and stay cached across app updates.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'pdf': ['@react-pdf/renderer', 'html2canvas', 'jspdf'],
          'maps': ['leaflet', '@googlemaps/js-api-loader'],
          'flow': ['reactflow'],
          'sheet': ['xlsx'],
        },
      },
    },
  },
})
