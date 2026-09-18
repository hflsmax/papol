// What every browser has and Node does not, for the unit tests: each test
// fakes the `window` it needs, and the shared modules reach for these two as
// bare globals the way page code does. Loaded with `node --import`.
globalThis.document ??= { addEventListener() {}, visibilityState: 'hidden' };
globalThis.BroadcastChannel = class { postMessage() {} close() {} };
