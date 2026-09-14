import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // History API routes such as /paper/<doi> must load the same root assets;
  // a relative base would incorrectly request /paper/<doi>/assets/….
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    // The demo world is shared between the two apps, a level above
    // either root.
    fs: { allow: ['..'] },
    proxy: {
      // Keep all three development surfaces on one browser origin. Besides
      // matching production routing, this lets the desktop shell carry its
      // login and viewer handoff into the separately hosted Vite apps.
      '/demo/viewer': {
        target: 'http://127.0.0.1:5174',
        rewrite: (path) => path.replace(/^\/demo\/viewer/, '/viewer') || '/viewer/',
        ws: true,
      },
      '/demo/boards': {
        target: 'http://127.0.0.1:5175',
        rewrite: (path) => path.replace(/^\/demo\/boards/, '/boards') || '/boards/',
        ws: true,
      },
      '/viewer': {
        target: 'http://127.0.0.1:5174',
        ws: true,
      },
      '/boards': {
        target: 'http://127.0.0.1:5175',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
