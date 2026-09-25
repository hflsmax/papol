// An announcement as the admin writes it, in Markdown, made into the two
// forms an email carries: HTML for mail apps that show it (pictures and
// all, set plainly), and plain text for the ones that don't. Only what a letter uses:
// headings, paragraphs, **bold**, *italics*, `code`, [links](url),
// ![pictures](url), bullet lists, --- rules and a line ending in \ for a
// line break. A plain-text announcement is a Markdown one with nothing
// marked, so it reads as before. The writer is the admin, but every
// character is escaped anyway: nothing typed can become markup.

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Only web addresses make links or pictures; anything else stays text.
const safeUrl = (url: string) => /^https?:\/\//i.test(url.trim());

// The words of a link or picture, which may hold one level of brackets
// ("Clicking [47] opens its card"), then its address.
const LABEL = String.raw`((?:[^\[\]]|\[[^\]]*\])*)`;
const PICTURE = new RegExp(String.raw`!\[${LABEL}\]\(([^)\s]+)\)`, "g");
const LINK = new RegExp(String.raw`\[${LABEL}\]\(([^)\s]+)\)`, "g");
const ONLY_PICTURE = new RegExp(String.raw`^!\[${LABEL}\]\(([^)\s]+)\)$`);

// Plain, as an email a person writes: the mail app's own sans-serif at its
// usual size, no background or card, headings only bold, links the usual
// blue, pictures unframed. Just enough to hold a column and a picture.
const STYLE = {
  body: "margin:0;padding:16px;",
  sheet: "max-width:640px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;"
    + "font-size:15px;line-height:1.5;color:#222222;",
  h1: "margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:bold;",
  h2: "margin:24px 0 6px;font-size:16px;line-height:1.35;font-weight:bold;",
  h3: "margin:20px 0 4px;font-size:15px;line-height:1.4;font-weight:bold;",
  p: "margin:0 0 12px;",
  img: "display:block;max-width:100%;height:auto;margin:4px 0 16px;",
  a: "color:#1a5fb4;",
  code: "font-family:Menlo,Consolas,monospace;font-size:14px;",
  hr: "border:0;border-top:1px solid #dddddd;margin:20px 0;",
  ul: "margin:0 0 12px;padding-left:22px;",
};

// Inline marks within one block of text, escaped first.
function inline(text: string): string {
  let out = escape(text);
  out = out.replace(PICTURE, (whole, alt, url) =>
    safeUrl(url) ? `<img src="${url}" alt="${alt}" style="${STYLE.img}">` : whole);
  out = out.replace(LINK, (whole, label, url) =>
    safeUrl(url) ? `<a href="${url}" style="${STYLE.a}">${label}</a>` : whole);
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code style="${STYLE.code}">${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
  return out.replace(/\\\n/g, "<br>").replace(/\n/g, " ");
}

type Block = { kind: "h" | "p" | "hr" | "ul" | "img"; level?: number; text?: string; items?: string[] };

function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  const chunks = markdown.replace(/\r\n?/g, "\n").trim().split(/\n\s*\n/);
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const heading = /^(#{1,3})\s+(.*)$/s.exec(chunk);
    if (heading && !chunk.includes("\n")) out.push({ kind: "h", level: heading[1].length, text: heading[2] });
    else if (/^(-{3,}|\*{3,})$/.test(chunk)) out.push({ kind: "hr" });
    else if (chunk.split("\n").every((line) => /^[-*]\s+/.test(line))) out.push({ kind: "ul", items: chunk.split("\n").map((line) => line.replace(/^[-*]\s+/, "")) });
    else if (ONLY_PICTURE.test(chunk)) out.push({ kind: "img", text: chunk });
    else out.push({ kind: "p", text: chunk });
  }
  return out;
}

export function letterHtml(markdown: string): string {
  const body = blocks(markdown).map((block) => {
    switch (block.kind) {
      case "h": {
        const tag = `h${block.level}`;
        return `<${tag} style="${STYLE[tag as "h1" | "h2" | "h3"]}">${inline(block.text!)}</${tag}>`;
      }
      case "hr": return `<hr style="${STYLE.hr}">`;
      case "ul": return `<ul style="${STYLE.ul}">${block.items!.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`;
      case "img": return inline(block.text!);
      default: return `<p style="${STYLE.p}">${inline(block.text!)}</p>`;
    }
  }).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="${STYLE.body}"><div style="${STYLE.sheet}">${body}</div></body></html>`;
}

// The same letter for a mail app that shows no HTML: the marks taken off,
// a link's address after its words, and no pictures.
export function letterText(markdown: string): string {
  return blocks(markdown).map((block) => {
    const plain = (text: string) => text
      .replace(PICTURE, "")
      .replace(LINK, (_, label, url) => (label === url.replace(/^https?:\/\//, "") ? url : `${label} (${url})`))
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\\\n/g, "\n")
      .trim();
    switch (block.kind) {
      case "h": return plain(block.text!).toUpperCase();
      case "hr": return "—";
      case "ul": return block.items!.map((item) => `- ${plain(item)}`).join("\n");
      case "img": return "";
      default: return plain(block.text!);
    }
  }).filter(Boolean).join("\n\n");
}
