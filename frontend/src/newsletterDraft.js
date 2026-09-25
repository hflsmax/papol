// A letter drafted in newsletters/<name>/letter.md, as the admin's email
// form takes it: the subject is the letter's title (its first "# " line),
// the body is the whole letter, Markdown, which the Worker sends as HTML
// with a plain-text copy (cloudflare/src/jobs/letter.ts).
export function parseDraft(name, markdown) {
  const text = markdown.replace(/\r\n?/g, '\n').trim();
  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() || name;
  return { name, subject: title, body: text };
}

// Newest first: a letter's directory begins with the day it covers up to.
export function draftsFrom(files) {
  return Object.entries(files)
    .map(([path, markdown]) => parseDraft(path.split('/').at(-2), markdown))
    .sort((a, b) => b.name.localeCompare(a.name));
}
