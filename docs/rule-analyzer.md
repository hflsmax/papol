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
Worker calls it where `ANALYZER = "rules"` — production and dev
(`cloudflare/wrangler.toml`); GROBID is still asked for `/header`, and
for `/analyze` where the var is unset.

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
- `floats.ts` — floats (figures, tables, boxes, algorithms, listings): each
  found by its caption ("Figure 3:", "Fig. 1 |", a bold "Fig. 1 (a)…") and
  sized by the `float.*` rules out of what the page paints (paths and
  images, read from pdf.js's operator list in `pdf.ts`) and the text set
  among it. A float is found by what bounds it, never by how far it
  reaches — a figure can be any height, with any space inside it. First
  the paper's type is measured (`float.type`): its text font, leading,
  measure, text area and columns. Running text is then recognised by that
  type (`float.prose`), and a float is everything that starts between its
  caption and the first bound on its usual side — running text, a heading,
  another caption, a float already sized — across the columns its caption
  is set across (`float.band`). Touching strokes are taken as one piece
  (`float.piece`). A frame around a caption, and an algorithm or booktabs
  table set between rules, are rules of their own. Tables are sized
  before figures. Then the mentions of each in the text. A float is a box
  of its own (`paper_floats`); a link names the float it goes to, and the
  viewer brings the float's box into view a little below the middle of the
  window, across as well as down.
- `sections.ts` — numbered sections: each found by its heading (a line
  opening with a section number and a title, mostly bold or larger than the
  text, not inside a float, not a contents entry; `section.heading`), and
  the mentions of each ("Section 2.1", "Sections 3 and 4", "§3";
  `mention.section`). A section is stored as a float of kind `section`
  whose box is its heading, and the viewer takes a link to it to the top
  of the window, as the PDF's own section links do.
- `footnotes.ts` — footnotes: each note found at the foot of its page (a
  line smaller than the text opening with a raised number and then words,
  nothing at the text's size under it; `footnote.note`), and each raised
  number in the text whose note is on the same page (`footnote.marker`),
  unless the paper cites with raised numbers and it is a citation. A note
  is stored as a float of kind `footnote`.
- `bibliography.ts` — where the bibliography is (under its heading, down to
  a heading that ends it, kept only if it reads as one), where each entry
  begins (numbered, labelled, a hanging indent learned from the list, or
  gaps), and each entry's fields: DOI, arXiv id, year, authors, title.
- `citations.ts` — citation markers: bracketed or parenthesized numbers,
  superscripts, author–year (grouped and narrative), alpha labels. Every way
  is tried, and the paper's way is the one that names the most different
  entries.
- `analyze.ts` — the whole, answering `Analysis` and a trace.
- `header.ts` — the title block, for the upload form (`POST
  /helper/header-rules`, `HeaderMetadata`): below.

In the viewer (`viewer/src/references.js`), the analyzer's citations and
links come first; a PDF's own links fill in only where the analyzer found
nothing. Publishers often link only part of a marker — Nature the "66" of
"66–73", hyperref the "3b" of "Fig. 3b" — so the PDF's link is the lesser
reading wherever both exist.

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
    CHROME=… node scripts/overlay/render.mjs .corpus/pdf .corpus/rules .corpus/shots [sha…]   # body, floats and bibliography sheets
    node scripts/run-script.mjs lines <pdf> [pages] [grep]           # lines as the analyzer sees them
    node scripts/run-script.mjs bib <pdf> [n]                        # the bibliography as read
    node scripts/run-script.mjs floats <pdf> <page> ["figure 3"]     # how each float grew, and what stopped it

The drawings put citations in blue (tagged with the entry they name),
figure and table links in thin green, floats outlined in thick green, entries in
orange, captions in purple, over each page as pdf.js draws it.

On 2026-09-23, over all 43 papers: references matched GROBID's count on
most and exceeded it where GROBID missed entries (short URL entries, the
tail of a list); every paper with a numbered bibliography cites 95–100% of
its entries; author–year papers 82–100%; figure mentions GROBID dropped
("Figure 10" in the paper that started this) are linked.

Known gaps: a caption set as part of an image, or a float with no caption,
is not found; unusual citation wording ("Plate 3") is not recognized.

## The title block

Written 2026-09-25. The upload form asks the helper for a paper's title,
authors, journal, year, DOI and arXiv id when the browser read no
identifier off the first pages, or one no index knows
(`cloudflare/src/papers/extract.ts`). GROBID's header model answered that
(`/header`); `header.ts` reads it by rules (`/header-rules`), where
`ANALYZER = "rules"`, from the first three pages:

- the title is the first page's largest text in its top two thirds, with
  the lines of that size under it and an ACM subtitle; not a banner, a
  notice, a line of names or an Elsevier masthead; a scanned title is the
  running head of the next pages;
- the authors are the names under it before the abstract, split at commas,
  "and", affiliation marks and wide gaps, an affiliation ending its line;
  TeX's detached accents are put back on their letters; an IOP cover
  sheet's "To cite this article" line is taken instead;
- the year is a printed publication date or ©, a journal line's year, a
  "YYYY, Vol." line or the acceptance, and last an arXiv number's;
- the journal is an Elsevier masthead, a Nature or APS running line, an ACM
  reference paragraph's proceedings, or a known abbreviation;
- the DOI and arXiv id are found as the browser finds them
  (`shared/identifiers.js`).

It reads only the PDF: nothing is asked of any index. GROBID's header also
asked Crossref for a DOI the page does not print (`consolidateHeader`);
the rules do not, by the owner's decision — a paper that prints no
identifier keeps what its title block says. (Over the 48 papers,
Crossref's lookup had found one such DOI.)

Judged against the papers' rows in production, which are mostly what
Crossref says (`truth.json`, exported from D1), beside GROBID's answers
(`grobid-header.tsv`, one `/header` answer per paper):

    cd host/helper
    node scripts/run-script.mjs header .corpus/pdf [sha-prefix]     # ✓/✗ per field, rules then GROBID
    VERBOSE=1 node scripts/run-script.mjs header .corpus/pdf        # with every answer

To fetch them: `npx wrangler d1 execute papol --remote --json --command
"SELECT sha256, doi, title, authors, journal, year FROM papers WHERE
deleted_at IS NULL"` (authors parsed from JSON), each PDF from
`https://files.papol.io/uploads/<sha256>.pdf`, and GROBID's answer by
posting `{"url": …}` to the helper's `/header` on the host.

On 2026-09-25, over all 48 papers (a field counted where the row has it):
title 47/48 (GROBID 46), authors 44/47 (45), year 32/33 (32), DOI 37/37
(33), journal 21/30 (22 — GROBID's journal is Crossref's, looked up). The
misses: a book's title page; an author the draft lists and the published
paper does not; a name Crossref itself has garbled; an arXiv copy's year
beside the published one's. The journal matters least: it is kept only
when no index knows the paper.
