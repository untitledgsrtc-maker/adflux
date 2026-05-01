import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@':           fileURLToPath(new URL('./src', import.meta.url)),
      '@/components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@/pages':     fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@/lib':       fileURLToPath(new URL('./src/lib', import.meta.url)),
      '@/store':     fileURLToPath(new URL('./src/store', import.meta.url)),
      '@/styles':    fileURLToPath(new URL('./src/styles', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    sourcemap: true,
    target: 'es2020',
  },
});
