import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Relative asset URLs, so the app works both at / (papol.local) and under
  // a proxied subpath (mc-pony.com/papol/).
  base: './',
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
