// A release's version, and the files that carry it.
//
//   node scripts/release-version.mjs next <patch|minor|major|X.Y.Z> [LATEST]
//   node scripts/release-version.mjs stamp <X.Y.Z>
//
// A release is cut by the Papol macOS workflow, not from anyone's checkout,
// so the version is never committed: the releases themselves say which one
// came last (their macos-v* tags), `next` works out the one after, and
// `stamp` writes it into the build's own copy of the files the app and its
// build read it from. The versions committed in desktop/ only name what a
// local build calls itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version) {
  const match = STABLE.exec(version);
  if (!match) throw new Error(`not a stable version: ${version}`);
  return match.slice(1).map(Number);
}

function compare(left, right) {
  const [a, b] = [parts(left), parts(right)];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// The version after LATEST that REQUEST asks for. With no release yet,
// the committed version is where counting starts. A release only ever
// moves forwards.
export function nextVersion(request, latest, committed) {
  const base = latest || committed;
  const [major, minor, patch] = parts(base);
  const version = request === 'patch' ? `${major}.${minor}.${patch + 1}`
    : request === 'minor' ? `${major}.${minor + 1}.0`
      : request === 'major' ? `${major + 1}.0.0`
        : request;
  if (!STABLE.test(version)) throw new Error('a release is patch, minor, major, or X.Y.Z');
  if (latest && compare(version, latest) <= 0) {
    throw new Error(`${version} is not after the latest release, ${latest}`);
  }
  return version;
}

// Every file that states the version, each in exactly one place: the
// crate's (what the running app reports about itself) and its lock, or
// every --locked build stops; the app's package and lock; Tauri's config,
// which names the bundle.
export const VERSION_FIELDS = [
  ['package.json', /^( {2}"version": ")[^"]+(",)$/m],
  ['package-lock.json', /^( {2}"version": ")[^"]+(",)$/m],
  // The root package's own entry; every dependency has a version too.
  ['package-lock.json', /^( {4}"": \{\n {6}"name": "papol-desktop",\n {6}"version": ")[^"]+(",)$/m],
  ['src-tauri/tauri.conf.json', /^( {2}"version": ")[^"]+(",)$/m],
  // Only the crate's own [package] version sits at the start of a line;
  // every dependency states its version indented or inline.
  ['src-tauri/Cargo.toml', /^(version = ")[^"]+(")$/m],
  ['src-tauri/Cargo.lock', /^(name = "papol-desktop"\nversion = ")[^"]+(")$/m],
];

export function stamp(source, pattern, version, file) {
  const count = source.match(new RegExp(pattern.source, `${pattern.flags}g`))?.length ?? 0;
  if (count !== 1) throw new Error(`expected one version field in ${file}, found ${count}`);
  return source.replace(pattern, (_, before, after) => `${before}${version}${after}`);
}

function committedVersion() {
  return JSON.parse(readFileSync(join(DESKTOP, 'src-tauri/tauri.conf.json'), 'utf8')).version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument, latest] = process.argv.slice(2);
  try {
    if (command === 'next') {
      console.log(nextVersion(argument, latest || '', committedVersion()));
    } else if (command === 'stamp') {
      parts(argument);
      for (const [file, pattern] of VERSION_FIELDS) {
        const path = join(DESKTOP, file);
        writeFileSync(path, stamp(readFileSync(path, 'utf8'), pattern, argument, file));
      }
      console.log(`stamped ${argument}`);
    } else {
      throw new Error('usage: release-version.mjs next <patch|minor|major|X.Y.Z> [LATEST] | stamp <X.Y.Z>');
    }
  } catch (error) {
    console.error(`release-version: ${error.message}`);
    process.exit(1);
  }
}
