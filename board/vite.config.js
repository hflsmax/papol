import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative assets remain inside /boards (or /demo/boards) when the board is
// addressed as /boards/<guid>, including below a /papol deployment prefix.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8000', '/uploads': 'http://127.0.0.1:8000' },
  },
});
