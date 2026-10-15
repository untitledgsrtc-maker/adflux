import { defineConfig } from 'vite'
export default defineConfig({
  clearScreen: false,
  // inline postcss config: stops Vite from picking up ../postcss.config.js (the website's tailwind setup)
  css: { postcss: { plugins: [] } },
  server: { port: 1420, strictPort: true, fs: { allow: ['..', '../..'] } },
  build: { target: 'es2021', outDir: 'dist', emptyOutDir: true },
})
