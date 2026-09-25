import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // History API routes such as /paper/<doi> must load the same root assets;
  // a relative base would incorrectly request /paper/<doi>/assets/….
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  // shared/ sits outside the root and names its packages bare; these are
  // resolved from this app, where they are installed.
  resolve: { dedupe: ['react', 'react-dom', '@noble/hashes'] },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            name: 'react-vendor',
            test: /node_modules\/(?:react|react-dom|scheduler)\//,
          }],
        },
      },
    },
  },
  server: {
    // shared/ sits a level above either app's root.
    fs: { allow: ['..'] },
    proxy: {
      // Keep all three development surfaces on one browser origin. Besides
      // matching production routing, this lets the desktop shell carry its
      // login and viewer handoff into the separately hosted Vite apps.
      '/viewer': {
        target: 'http://127.0.0.1:5174',
        ws: true,
      },
      '/boards': {
        target: 'http://127.0.0.1:5175',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      // A short link is answered by the Worker, which sends it on to the viewer.
      '/s/': {
        target: 'http://127.0.0.1:8787',
      },
    },
  },
})
