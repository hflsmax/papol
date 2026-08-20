import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by the Papol backend under /viewer/, so every asset URL is
// relative — the app must work at that subpath and behind the proxy.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // The demo world is shared between the two apps, a level above
    // either root.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8000', '/uploads': 'http://127.0.0.1:8000' },
  },
});
