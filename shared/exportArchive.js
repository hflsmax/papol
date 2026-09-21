// The export, assembled where the CPU is: in the browser.
//
// The Worker answers the export with a tar of the data alone, and one
// entry in it, files.json, names every file that belongs beside the
// data and where each one lives. Pushing a byte through a Worker's
// stream costs it CPU whether or not it looks at the byte, and a nook's
// PDFs are more bytes than an invocation is given; fetched one URL at a
// time, each is the bucket's object answered as it is, which costs the
// Worker nothing. The browser reads the tar, fetches the files, and
// lays everything out for one zip.

const decoder = new TextDecoder();

function field(block, offset, length) {
  return decoder.decode(block.subarray(offset, offset + length)).replace(/\0[\s\S]*$/, '');
}

// A tar, read back: each entry a 512-byte header naming and sizing the
// bytes that follow, padded to the block; two empty blocks at the end.
// The names keep their root folder. Anything but a plain file is skipped.
export function untar(bytes) {
  const entries = new Map();
  for (let at = 0; at + 512 <= bytes.length;) {
    const block = bytes.subarray(at, at + 512);
    if (block.every((b) => b === 0)) break;
    let summed = 0;
    for (let i = 0; i < 512; i++) summed += i >= 148 && i < 156 ? 32 : block[i];
    if (parseInt(field(block, 148, 8), 8) !== summed) throw new Error('This is not a Papol export');
    const size = parseInt(field(block, 124, 12), 8);
    const prefix = field(block, 345, 155);
    const name = (prefix ? `${prefix}/` : '') + field(block, 0, 100);
    const type = field(block, 156, 1);
    if (type === '' || type === '0') entries.set(name, bytes.slice(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

// What the zip will hold: the tar's entries, and beside them under the
// same root every file the manifest names, as `fetchFile` brings each
// back. The tar's entries are text and deflate; the files are PDFs and
// images, already compressed, and are stored as they are. A file that
// cannot be fetched is left out and named in `failed`; the rest of the
// export does not wait on it.
export async function assembleExport(tarBytes, fetchFile, { onProgress = () => {}, concurrency = 4 } = {}) {
  const entries = untar(tarBytes);
  const manifestName = [...entries.keys()].find((name) => /(^|\/)files\.json$/.test(name));
  if (!manifestName) throw new Error('The export names no files');
  const root = manifestName.slice(0, manifestName.length - 'files.json'.length);
  const manifest = JSON.parse(decoder.decode(entries.get(manifestName)));
  const zip = {};
  for (const [name, bytes] of entries) zip[name] = [bytes, { level: 6 }];

  const failed = [];
  const queue = manifest.slice();
  let done = 0;
  onProgress({ done, total: manifest.length });
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      try {
        zip[`${root}${file.path}`] = [await fetchFile(file), { level: 0 }];
      } catch {
        failed.push(file.path);
      }
      done += 1;
      onProgress({ done, total: manifest.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, manifest.length) }, worker));
  return { root, entries: zip, failed };
}
