import { defineConfig } from 'vite';

// Preload build. CJS output named explicitly so it sits next to main.js
// as .vite/build/preload.js (referenced from BrowserWindow webPreferences).
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
});
