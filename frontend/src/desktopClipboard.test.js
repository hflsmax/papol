import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeHarness } from '../../shared/testing/nativeHarness.js';

const native = await installNativeHarness();
const { copyText } = await import('../../shared/nativeData.js');
const { sharableHref } = await import('../../shared/api/sharables.js');

// The Mac's webview, as it answered Share's Copy link: the link arrives
// after the service has made it, the click has lapsed, and WebKit refuses
// the page's own write.
function refusingWebClipboard() {
  const writes = [];
  navigator.clipboard = {
    writeText: async (text) => {
      writes.push(text);
      throw new DOMException('The request is not allowed by the user agent', 'NotAllowedError');
    },
  };
  return writes;
}

test('on the Mac a link goes onto the clipboard through the application, not the webview', async () => {
  const webWrites = refusingWebClipboard();
  const link = sharableHref('abc123');
  await copyText(link);
  assert.deepEqual(native.argsOf('clipboard_write_text'), [{ text: link }]);
  assert.deepEqual(webWrites, []);
});

test('a pasteboard that will not take the link is reported, so the button says it failed', async () => {
  refusingWebClipboard();
  native.on('clipboard_write_text', () => { throw 'The link could not be put on the clipboard'; });
  await assert.rejects(copyText('https://papol.io/s/abc123'), (failure) => /could not be put on the clipboard/.test(failure));
});
