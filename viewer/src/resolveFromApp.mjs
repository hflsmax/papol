// A module resolution hook for the unit tests, registered by browserGlobals.mjs.
//
// The shared modules (../../shared) name their dependencies by bare name —
// 'react', '@noble/hashes/sha2.js' — and Vite finds them in this app's
// node_modules. Node resolves from the importing file, and shared/ has no
// node_modules of its own, so a bare name that cannot be found from there
// is looked up again from this app, which is where the page would find it.

const APP = new URL('../package.json', import.meta.url).href;

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    const bare = !/^[./]/.test(specifier) && !specifier.includes(':');
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !bare) throw error;
    return next(specifier, { ...context, parentURL: APP });
  }
}
