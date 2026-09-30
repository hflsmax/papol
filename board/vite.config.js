import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The commit this build came from, which a feedback report names.
const build = (process.env.GITHUB_SHA || '').slice(0, 7) || 'local';

// Relative assets remain inside /boards when the board is
// addressed as /boards/<guid>, including below a /papol deployment prefix.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/boards/' : './',
  plugins: [react()],
  define: { __PAPOL_BUILD__: JSON.stringify(build) },
  // Desktop-only UI is shared from the frontend package. Keep its hooks on
  // the same React runtime as the board in production builds.
  // shared/ sits outside the root and names its packages bare; these are
  // resolved from this app, where they are installed.
  resolve: { dedupe: ['react', 'react-dom', '@noble/hashes', 'linkpeek', 'katex'] },
  server: {
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8787', '/uploads': 'http://127.0.0.1:8787' },
  },
}));
