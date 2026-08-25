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
  //
  // Phase 323 (perf audit C3) — the object form above mis-homed a SHARED module
  // (react/jsx-runtime + Vite's preload helper) into the `pdf` chunk, which made
  // the ENTRY statically import pdf → the whole 602 KB react-pdf/jspdf/html2canvas
  // stack downloaded on EVERY cold open, for all 22 users, even reps who never
  // render a PDF. The FUNCTION form fixes it: only node_modules are chunked, by
  // path; Vite's own preload helper (not in node_modules) stays in the entry, and
  // jsx-runtime lands in react-vendor (always loaded) — never in pdf. So pdf/flow/
  // sheet/maps become TRULY load-on-demand. Cold path ~810 KB → ~210 KB gz.
  //
  // ORDER MATTERS: `@react-pdf/renderer` and `reactflow` both contain "react" in
  // their path, so they MUST be matched before the generic react-vendor branch or
  // they'd wrongly ride the always-loaded react-vendor chunk (re-creating the bug).
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's dynamic-import/preload helper (minified `_`) is imported by
          // EVERY dynamic import. Left unmatched, Rollup parks it inside a lazy
          // vendor chunk (it landed in `pdf`), forcing pdf to load on every cold
          // open. Pin it (+ Rollup's commonjs helper) into the always-loaded
          // react-vendor chunk so the heavy chunks stay truly lazy.
          if (id.includes('vite/preload-helper') || id.includes('vite/modulepreload') ||
              id.includes('vite/dynamic-import-helper') || id.includes('commonjsHelpers')) return 'react-vendor'
          if (!id.includes('node_modules')) return undefined
          // Heavy, page-specific libs — load-on-demand. Check BEFORE react-vendor
          // (`@react-pdf/renderer` + `reactflow` both contain "react" in the path).
          if (id.includes('@react-pdf') || id.includes('html2canvas') ||
              id.includes('jspdf') || id.includes('pdfkit') || id.includes('fontkit')) return 'pdf'
          if (id.includes('reactflow') || id.includes('@reactflow')) return 'flow'
          if (id.includes('/xlsx')) return 'sheet'
          if (id.includes('/leaflet') || id.includes('@googlemaps')) return 'maps'
          if (id.includes('@supabase')) return 'supabase'
          // zustand is a dep of BOTH the app's global stores (authStore etc., always
          // loaded) AND reactflow — so it MUST live in an eager chunk, or the store
          // tree drags the whole `flow` chunk onto the cold path (it did). Pin eager.
          if (id.includes('/zustand')) return 'react-vendor'
          // React runtime — always loaded (the entry needs it). jsx-runtime lands
          // here, NOT in pdf, which is the whole point.
          if (id.includes('/react-dom') || id.includes('/react-router') ||
              id.includes('/react/') || id.includes('/scheduler')) return 'react-vendor'
          // Everything else in node_modules → Rollup's default vendor split.
          return undefined
        },
      },
    },
  },
})
