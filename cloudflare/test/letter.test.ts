import { describe, expect, it } from "vitest";
import { letterHtml, letterText } from "../src/jobs/letter";

describe("an announcement's Markdown, as an email", () => {
  const letter = [
    "# What's new in Papol",
    "Hello,",
    "Papol moved to **Cloudflare**, at [papol.io](https://papol.io).\nIt reads `[`.",
    "## 1. Intelligent link navigation",
    "![A link followed](https://files.papol.io/admin/abc.gif)",
    "- one\n- two",
    "---",
    "The Papol team",
  ].join("\n\n");

  it("makes HTML: headings, paragraphs, marks, links and pictures", () => {
    const html = letterHtml(letter);
    expect(html).toMatch(/<h1 style="[^"]+">What's new in Papol<\/h1>/);
    expect(html).toMatch(/<h2 style="[^"]+">1. Intelligent link navigation<\/h2>/);
    expect(html).toContain("<strong>Cloudflare</strong>");
    expect(html).toMatch(/<a href="https:\/\/papol.io" style="[^"]+">papol.io<\/a>/);
    expect(html).toMatch(/<code style="[^"]+">\[<\/code>/);
    expect(html).toMatch(/<img src="https:\/\/files.papol.io\/admin\/abc.gif" alt="A link followed" style="[^"]+">/);
    expect(html).toContain("<li>one</li><li>two</li>");
    expect(html).toMatch(/<hr style=/);
    // A line break inside a paragraph is a space, as Markdown reads it.
    expect(html).toContain("papol.io</a>. It reads");
  });

  it("escapes what is typed, and links only web addresses", () => {
    const html = letterHtml('<script>alert(1)</script> [x](javascript:alert(1)) ![y](data:image/png;base64,AA) "quoted"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/href="javascript/);
    expect(html).not.toMatch(/src="data:/);
    expect(html).toContain("&quot;quoted&quot;");
  });

  it("makes plain text: the marks off, a link's address after its words, no pictures", () => {
    const text = letterText(letter);
    expect(text).toContain("WHAT'S NEW IN PAPOL");
    expect(text).toContain("Papol moved to Cloudflare, at https://papol.io.");
    expect(text).not.toContain("files.papol.io");
    expect(text).toContain("- one\n- two");
    expect(letterText("[the letter](https://example.org/a)")).toBe("the letter (https://example.org/a)");
  });

  it("leaves a plain-text announcement as it was written", () => {
    expect(letterText("Hello,\n\nPapol is live.")).toBe("Hello,\n\nPapol is live.");
  });
});
