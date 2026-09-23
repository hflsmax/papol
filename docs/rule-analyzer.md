# The rule-based analyzer

Written 2026-09-23. GROBID reads a paper with a trained model, and gets
wrong what it was not trained on: it took lines of body text for figure
captions (and so dropped the mentions in them), merged two captions into
one, and pointed "Figure 21" at Figure 2. The rule-based analyzer reads the
same things — a paper's references, the citations that point at them, and
the links to its figures and tables — with hand-written rules about how
papers are set, and answers in exactly GROBID's shape (`Analysis` in
`cloudflare/src/papers/tei.ts`), so nothing downstream changes.

It runs in the helper on the GROBID host (`POST /helper/analyze-rules`),
not in the Worker: reading a PDF is CPU the Worker should not spend. The
Worker calls it where `ANALYZER = "rules"` — dev only, for now
(`cloudflare/wrangler.toml`); production still asks GROBID.

## How it reads

`host/helper/src/rules/`, one layer a file:

- `pdf.ts` — the PDF's text as positioned runs, through pdf.js (unpdf):
  each run's box, font size, and whether its font's name says bold or italic.
- `layout.ts` — runs into lines (clustered by baseline, then cut at gutters;
  superscripts and subscripts joined to their line; list labels set in a
  margin column joined to their text), page furniture set aside, and reading
  order by recursive XY-cut. Every page's text becomes one string, a *flow*,
  whose every character still knows where it was printed: rules match text,
  and their answers are boxes on the page.
- `floats.ts` — captions ("Figure 3:", "Fig. 1 |", a bold "Fig. 1 (a)…"),
  where each float lands (the blank above a figure's caption, a table's
  caption itself), and the mentions of each in the text.
- `bibliography.ts` — where the bibliography is (under its heading, down to
  a heading that ends it, kept only if it reads as one), where each entry
  begins (numbered, labelled, a hanging indent learned from the list, or
  gaps), and each entry's fields: DOI, arXiv id, year, authors, title.
- `citations.ts` — citation markers: bracketed or parenthesized numbers,
  superscripts, author–year (grouped and narrative), alpha labels. Every way
  is tried, and the paper's way is the one that names the most different
  entries.
- `analyze.ts` — the whole, answering `Analysis` and a trace.

## How the rules are kept

Every rule is registered once in `registry.ts`: an id (`stage.name`), what
it recognizes, why it exists (which kind of paper needed it), and — for a
pattern rule — examples it must match and must not. `test/rules.test.mjs`
holds every rule to its own examples. Everything the analyzer produces is
recorded in a trace against the rule that produced it, so a wrong answer on
a page names the rule to look at.

To fix a misreading: find the rule in the trace, add the text it got wrong
to that rule's `rejects` (or the text it missed to its `matches`), change
the rule until its examples pass, and rerun the corpus.

## The corpus

Every production PDF, read and drawn, is how a change is judged. It lives
in `host/helper/.corpus/` (not committed): `pdf/` the papers,
`grobid_*.json` GROBID's stored answers from production, `rules/` the
analyzer's, `shots/` the drawings.

    cd host/helper
    node scripts/run-script.mjs .corpus/pdf .corpus/rules .corpus    # a table beside GROBID's counts
    CHROME=… node scripts/overlay/render.mjs .corpus/pdf .corpus/rules .corpus/shots [sha…]
    node scripts/run-script.mjs lines <pdf> [pages] [grep]           # lines as the analyzer sees them
    node scripts/run-script.mjs bib <pdf> [n]                        # the bibliography as read

The drawings put citations in blue (tagged with the entry they name),
figure and table links in green (with a bar where each lands), entries in
orange, captions in purple, over each page as pdf.js draws it.

On 2026-09-23, over all 43 papers: references matched GROBID's count on
most and exceeded it where GROBID missed entries (short URL entries, the
tail of a list); every paper with a numbered bibliography cites 95–100% of
its entries; author–year papers 82–100%; figure mentions GROBID dropped
("Figure 10" in the paper that started this) are linked.

Known gaps: title-block extraction for the upload form still uses GROBID
(`/header`); a caption set as part of an image, or a float with no caption,
is not found; unusual citation wording ("Plate 3") is not recognized.
