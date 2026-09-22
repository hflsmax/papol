import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PDF.js fetches its image decoders (wasm/) and standard fonts at run time,
// relative to the viewer page. Serve them from the installed pdfjs-dist in
// development and emit them into every build, so scanned pages decode on any
// server and the files always match the library version.
const pdfjsRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const pdfjsAssetDirs = ['standard_fonts', 'wasm'];
const pdfjsAssetTypes = {
  '.js': 'text/javascript',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function pdfjsAssets() {
  let base = '/';
  return {
    name: 'papol-pdfjs-assets',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname;
        try {
          pathname = decodeURIComponent((request.url || '').split('?')[0]);
        } catch {
          return next();
        }
        const match = pathname.startsWith(base)
          && pathname.slice(base.length).match(/^(standard_fonts|wasm)\/([^/]+)$/);
        if (!match) return next();
        const file = join(pdfjsRoot, match[1], match[2]);
        let stats;
        try {
          stats = statSync(file);
        } catch {
          return next();
        }
        if (!stats.isFile()) return next();
        response.setHeader('Content-Type', pdfjsAssetTypes[extname(file)] || 'application/octet-stream');
        response.setHeader('Content-Length', stats.size);
        createReadStream(file).pipe(response);
      });
    },
    generateBundle() {
      for (const dir of pdfjsAssetDirs) {
        for (const entry of readdirSync(join(pdfjsRoot, dir), { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          this.emitFile({
            type: 'asset',
            fileName: `${dir}/${entry.name}`,
            source: readFileSync(join(pdfjsRoot, dir, entry.name)),
          });
        }
      }
    },
  };
}

// Served by the Worker under /viewer/, so every asset URL is
// relative — the app must work at that subpath and behind the proxy.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/viewer/' : './',
  plugins: [react(), pdfjsAssets()],
  // Desktop-only UI is shared from the frontend package. Without deduping,
  // a production build resolves React once from each package's node_modules;
  // hooks in the shared components then run against the wrong dispatcher.
  // shared/ sits outside the root and names its packages bare; these are
  // resolved from this app, where they are installed.
  resolve: { dedupe: ['react', 'react-dom', '@noble/hashes'] },
  server: {
    // shared/ sits a level above either app's root.
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://127.0.0.1:8787', '/uploads': 'http://127.0.0.1:8787' },
  },
}));
