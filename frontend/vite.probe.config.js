import base from './vite.config.js';
export default { ...base, build: { ...base.build, outDir: 'dist-probe', minify: false, sourcemap: true, rolldownOptions: { ...base.build.rolldownOptions, input: 'probe.html' } } };
