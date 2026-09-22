// What every browser has and Node does not, for the unit tests: each test
// fakes the `window` it needs, and the shared modules reach for these two as
// bare globals the way page code does. Loaded with `node --import`.
globalThis.document ??= { addEventListener() {}, visibilityState: 'hidden' };
globalThis.BroadcastChannel = class { postMessage() {} close() {} };

// The shared modules' bare imports resolve from this app, as under Vite.
import { register } from 'node:module';
register('./resolveFromApp.mjs', import.meta.url);
