import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // History API routes such as /paper/<doi> must load the same root assets;
  // a relative base would incorrectly request /paper/<doi>/assets/….
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    // The demo world is shared between the two apps, a level above
    // either root.
    fs: { allow: ['..'] },
    proxy: {
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
