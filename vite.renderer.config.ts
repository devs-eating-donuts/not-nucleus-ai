import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Renderer build: plain Vite + React. No Node access here, ever.
export default defineConfig({
  plugins: [react()],
});
