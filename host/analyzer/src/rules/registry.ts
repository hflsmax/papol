// Every rule the analyzer applies, in one place.
//
// The analyzer is a set of hand-written rules about how papers are set:
// how a caption begins, how a bibliography entry is numbered, what an
// author–year citation looks like. There will be many, and they are only
// manageable if each is a thing with a name. So each rule is registered
// here once, with
//
//   - an id, stage.name, that the analysis records against everything the
//     rule produced (the trace), so a wrong answer on a page can be traced
//     to the one rule that gave it;
//   - what it recognizes and why it exists, in a sentence each: a rule is
//     added because some paper needed it, and says which kind of paper;
//   - for a pattern rule, examples it must match and examples it must not,
//     which test/rules.test.mjs checks for every rule. A rule changed to
//     fix one paper has to keep every example passing, and a new mistake
//     found on a page becomes a new `rejects` example before it is fixed.
//
// Rules that look at geometry rather than text (a hanging indent, a
// superscript) have no pattern and are tested with built pages instead;
// they are still listed, so the trace can name them.
//
// A pattern is tested against one line or one stretch of flowing text,
// with no anchoring beyond what it says itself.

export type Stage = "layout" | "caption" | "float" | "section" | "footnote" | "mention" | "bibliography" | "entry" | "field" | "citation" | "header";

export interface Rule {
  id: string;
  stage: Stage;
  summary: string;
  why: string;
  pattern?: RegExp;
  matches?: string[];
  rejects?: string[];
}

const rules: Rule[] = [];
const byId = new Map<string, Rule>();

function rule(r: Rule): Rule {
  if (byId.has(r.id)) throw new Error(`Rule ${r.id} is registered twice`);
  if (!r.id.startsWith(`${r.stage}.`)) throw new Error(`Rule ${r.id} is not named for its stage ${r.stage}`);
  rules.push(r);
  byId.set(r.id, r);
  return r;
}

export function allRules(): readonly Rule[] { return rules; }
export function ruleById(id: string): Rule {
  const found = byId.get(id);
  if (!found) throw new Error(`No rule ${id}`);
  return found;
}

// ---------------------------------------------------------------- layout

export const LAYOUT_SCRIPT = rule({
  id: "layout.script", stage: "layout",
  summary: "A run smaller than its line and raised (or lowered) against it is a superscript (or subscript) of that line.",
  why: "Nature, Science and Wiley papers cite with superscript numbers glued to the word before them.",
});
export const LAYOUT_LABEL_COLUMN = rule({
  id: "layout.label-column", stage: "layout",
  summary: "A line that is only a list label (\"2\", \"[12]\", \"1.\", a bullet), on the same baseline as text a short gutter to its right, is that text's label.",
  why: "LIPIcs and Nature set bibliography numbers in a margin column of their own, a gutter away from the entry.",
});
export const LAYOUT_GUTTER = rule({
  id: "layout.gutter", stage: "layout",
  summary: "Blank space between two runs on one baseline, which the lines just above and below also leave blank, is a gutter: the runs are in different columns and never one line.",
  why: "Nature Communications' gutter is narrower than a word space in its headings, so a gutter is recognized by lining up with its neighbours, not by its width.",
});
export const LAYOUT_SIZE_CHANGE = rule({
  id: "layout.size-change", stage: "layout",
  summary: "Two runs on the same baseline (not a raised or lowered script) that differ in size (beyond the 3% a size read off a transform is rounded to), with more than half an em between them, are two lines side by side, not one.",
  why: "Nature Reviews sets its captions smaller than the text and level with the column beside them, a gutter narrower than the text's gutter rule allows for.",
});
export const LAYOUT_COLUMNS = rule({
  id: "layout.columns", stage: "layout",
  summary: "A page is read by recursive XY-cut: split at the widest blank vertical strip (columns, left to right), else the widest blank horizontal band wider than line spacing (top to bottom), and again within each part.",
  why: "Pages mix layouts: two columns under a full-width title, a three-column bibliography under two-column text, a sidebar beside the body.",
});
export const LAYOUT_FURNITURE = rule({
  id: "layout.furniture", stage: "layout",
  summary: "Text in the top or bottom margin that recurs on several pages, or is only a page number, is page furniture and read by nothing.",
  why: "Running heads (\"Proc. ACM Program. Lang., Vol. 9\") and folios fall inside bibliographies and sentences.",
});
export const LAYOUT_HYPHEN = rule({
  id: "layout.hyphen", stage: "layout",
  summary: "A line ending in a letter and a hyphen, followed by one starting lower-case, is one word broken in two.",
  why: "\"Fig-\" / \"ure 2a-b\": a mention broken across lines is still a mention.",
});

// --------------------------------------------------------------- captions

const CAPTION_KINDS = "Figure|FIGURE|Fig\\.?|FIG\\.?|Table|TABLE|Tab\\.|TAB\\.|Box|BOX|Algorithm|ALGORITHM|Listing|LISTING";
const CAPTION_NUMBER = "S?\\d{1,3}(?:\\.\\d{1,3})?";

export const CAPTION_LABEL = rule({
  id: "caption.label", stage: "caption",
  summary: "A line that begins with a kind of float and its number, then a colon, full stop, bar or dash, begins that float's caption.",
  why: "Every style labels its captions this way (\"Figure 3:\", \"Fig. 1.\", \"Fig. 2 |\", \"Table 1 —\"); a sentence that starts \"Figure 3 shows\" does not.",
  pattern: new RegExp(`^\\s*(?<kind>${CAPTION_KINDS})\\s*(?<number>${CAPTION_NUMBER})\\s*(?:[.:|—–]|-)(?=\\s|$)`),
  matches: ["Figure 3: The door latch", "Fig. 1. Combining nonlinear", "Fig. 2 | Kinematics of", "Table 1 — Results", "TABLE 2. Parameters", "Figure 3.12: A linkage", "Figure S4: Supplementary", "Algorithm 1: Merge", "Figure 7:"],
  rejects: ["Figure 3 shows the latch", "Figures 3 and 4 show", "Fig. 3a, b", "Table 1 lists", "In Figure 3: nothing", "Figure 10 illustrates", "Fig. 10.D shows an impossible state"],
});
export const CAPTION_ALONE = rule({
  id: "caption.alone", stage: "caption",
  summary: "A line that is only a float's label, set in bold, heads that float's caption.",
  why: "Some styles set the label on a line of its own in bold (\"Figure 10\" above the caption's text).",
  pattern: new RegExp(`^\\s*(?<kind>${CAPTION_KINDS})\\s*(?<number>${CAPTION_NUMBER})\\s*$`),
  matches: ["Figure 10", "TABLE 2", "Fig. 4"],
  rejects: ["Figure 10 shows", "Figure"],
});
export const CAPTION_STYLED = rule({
  id: "caption.styled", stage: "caption",
  summary: "A line that begins with a kind of float and its number, with more after it, begins that float's caption when the label is bold or the line is set smaller than the text.",
  why: "ASME and some Elsevier styles write \"Fig. 1 (a) Physical prototype …\" with no punctuation after the number, marking the caption by type instead.",
  pattern: new RegExp(`^\\s*(?<kind>${CAPTION_KINDS})\\s*(?<number>${CAPTION_NUMBER})\\b\\s*\\S`),
  matches: ["Fig. 1 (a) Physical prototype", "Figure 2 Kinematics of the"],
  rejects: ["Figure", "Figures 3 and 4"],
});
// ----------------------------------------------------------------- floats
// How much of the page a float is: the box a link to it brings into view.

export const FLOAT_TYPE = rule({
  id: "float.type", stage: "float",
  summary: "The paper's type, measured before any float is: its text font (the font most characters at the text's size are set in), its leading (the usual baseline step between such lines), its measure (the usual width of a full line), its text area across (where that text is set on nearly every page), its margins (where its running heads and feet end), and two columns when the measure is well under the text's width.",
  why: "What bounds a float is the paper's running text, and papers differ in font, size and spacing; measuring them from the paper keeps the rules free of numbers fitted to one paper.",
});
export const FLOAT_PROSE = rule({
  id: "float.prose", stage: "float",
  summary: "Running text: a line in the paper's text font at its size, with no gap wider than an em and a half between words, one leading from another such line above or below, and either set to the full measure (within an indent of it), justified with that line (both edges shared, at least half the measure wide, and not by having as many characters, as monospaced code does), or the short last or indented first line of a paragraph that is; and any paragraph of three lines or more, at least half the measure wide, sharing both edges, in whatever font.",
  why: "A figure can be text — code, a grammar, rules of inference, a label in the text font — and a table's rows are words; what a float is not is the paper's own paragraphs.",
});
export const FLOAT_FRONT_MATTER = rule({
  id: "float.front-matter", stage: "float",
  summary: "An author's block — a line with an email address, and the lines stacked under it — bounds a float as running text does.",
  why: "A teaser figure under the title (ACM's UIST, CHI) has the author block over it, short centred lines that are no running text by any other rule.",
  pattern: /[\w.+-]+@[\w-]+\.[\w.]+/,
  matches: ["atpa@di.ku.dk", "Jane Doe (jane.doe@mit.edu)"],
  rejects: ["@article{x", "Department of Computer Science"],
});
export const FLOAT_GRAPHICS = rule({
  id: "float.graphics", stage: "float",
  summary: "What a page paints — filled or stroked paths, images — counts towards a float, except a page's background (over half the page), specks, a tint or box behind running text or a running head, and anything wholly outside the text area across, or above a page's running head or below its foot (the paper's, where the page has none) — a running-head rule, crop marks.",
  why: "Figures are drawn, not typeset; but PDFs also paint page backgrounds, crop marks, tinted running-head bars (a book's chapter band) and shaded text boxes that belong to no figure.",
});
export const FLOAT_CAPTION_PARAGRAPH = rule({
  id: "float.caption-paragraph", stage: "float",
  summary: "A caption goes on for the lines under its first at its size, each overlapping the ones above and no more than a line and a half of its size below them, with no rule drawn between; a second column of it level with its first line, just right of it, belongs to it when the caption is set smaller than the text. A float with nothing found either side of its caption is its caption.",
  why: "A caption is a paragraph, its label only the first line; centred last lines and Nature's two-column captions under wide figures are still the one paragraph.",
});
export const FLOAT_FRAME = rule({
  id: "float.frame", stage: "float",
  summary: "A drawn rectangle around a caption, several times its size, is the float: its frame, with the fills of the same width stacked against it, less than a line apart (a box's tinted title band and the panel under it).",
  why: "Nature's boxes, and framed listings, are set inside a rule or a tint with the caption at the top.",
});
export const FLOAT_BAND = rule({
  id: "float.band", stage: "float",
  summary: "A float is everything that starts between its caption and the first bound on its side — running text or a heading over or under the caption itself (beside it, it is text wrapped around the float), another caption, a float already sized — across the columns the caption is set across (and the caption, where it hangs into the margin), shared halfway with a caption level with it. No distance limits it: a figure can be any height, with any space inside it.",
  why: "Growing a float by what touches it cut figures short wherever their panels, or the figure and its caption, were set further apart than the limit; what a float is bounded by is the text around it.",
});
export const FLOAT_PIECE = rule({
  id: "float.piece", stage: "float",
  summary: "Paths and images that touch or overlap are one piece, which a float takes whole; a path that crosses running text or a caption joins nothing.",
  why: "A drawing is painted stroke by stroke; a float taking strokes one by one split a line drawing between two stacked figures (Demaine & O'Rourke's linkages).",
});
export const FLOAT_SIDE = rule({
  id: "float.side", stage: "float",
  summary: "Once every float has its bands, a figure whose caption has drawings (not lone rules: an equation's fraction bars) level with it — no text between, no other float's — is set beside them: it takes them, and the bands over and under them.",
  why: "Books and some journals (Nature Methods Primers, Science) set a narrow caption beside a figure that spans the rest of the page.",
});
export const FLOAT_CAPTION_OVERLEAF = rule({
  id: "float.caption-overleaf", stage: "float",
  summary: "A figure whose caption heads its page with nothing of its own, where the page before ends in drawings that no caption there took, is those drawings: the float is on the page before, where a link takes the reader.",
  why: "Nature Communications and Nature Reviews Methods Primers give a large figure a page of its own and set its caption at the top of the next page; the caption alone was the figure's box.",
});
export const FLOAT_OTHER_SIDE = rule({
  id: "float.other-side", stage: "float",
  summary: "Once every float on a page has its usual band, one that found nothing there takes what no float took on its other side, up to the next bound.",
  why: "Some figures are captioned over themselves; the usual side goes first so that stacked floats do not take each other's, and only when it is empty, since what follows a caption is otherwise the text resuming — a one-line paragraph, a theorem.",
});
export const FLOAT_FIGURE_EXTENT = rule({
  id: "float.figure-extent", stage: "float",
  summary: "A figure is the band over its caption; failing that, what is left under it.",
  why: "A figure is almost always set above its caption.",
});
export const FLOAT_TABLE_EXTENT = rule({
  id: "float.table-extent", stage: "float",
  summary: "A table (or algorithm, or listing) is the band under its caption (failing that, what is left over it), out of text and thin rules only, and ends at a picture. Tables are sized before figures, and a figure's band ends at them.",
  why: "Tables are captioned above themselves and are text and rules; a picture under a table is the next figure's.",
});
export const FLOAT_RULED = rule({
  id: "float.ruled", stage: "float",
  summary: "An algorithm or listing with rules under its caption, as wide as each other, runs down to the last of them before a bound — whatever is set between.",
  why: "Algorithms are set in the text's own font and size, so they read as running text; the rules around them are what bounds them.",
});

// --------------------------------------------------------------- mentions

export const MENTION_FLOAT = rule({
  id: "mention.float", stage: "mention",
  summary: "A kind of float named in running text followed by one or more numbers (\"Figure 3\", \"Figs. 3 and 4\", \"Fig. 1a,b\", \"Tables 2–4\") mentions each of them.",
  why: "The in-text pointer to a figure or table is what becomes a link to it.",
  pattern: /\b(?<kind>Figures?|FIGURES?|Figs?\.|FIGS?\.|Tables?|TABLES?|Tabs?\.|Box(?:es)?|BOX(?:ES)?|Algorithms?|Alg\.|Listings?)\s*(?<list>S?\d{1,3}(?:\.\d{1,3})?[a-z]?(?:\s*[-–—]\s*[a-z](?![a-z]))?(?:\s*(?:,|,?\s*and|,?\s*&|[-–—]|to)\s*S?\d{1,3}(?:\.\d{1,3})?[a-z]?(?:\s*[-–—]\s*[a-z](?![a-z]))?)*)/,
  matches: ["see Figure 3 for", "(Fig. 1a)", "Figs. 3 and 4", "Figures 3–5", "Table 2", "in Fig. 2a-b", "FIGURE 7", "Figure 3.12 shows"],
  rejects: ["figure out", "the Tables", "Figure", "Configure 3"],
});

// ---------------------------------------------------------------- sections

export const SECTION_HEADING = rule({
  id: "section.heading", stage: "section",
  summary: "A line that begins with a section number (\"2\", \"2.1\", \"2.1.3\", \"A.1\") and a capitalised title (a word, not a unit's letter; or \"3D …\"), mostly bold or larger than the text (by more than the half point its size is measured to), not inside a float, and not a contents entry (a title ending in its page number), heads that section; the first such line for a number is the section's.",
  why: "Numbered headings are where \"Section 2.1\" sends a reader, and the number is the one thing heading and mention share.",
  pattern: /^(?<number>(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3})\.?\s+(?<title>(?:[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F’'-]|\d[A-Za-z])[^]*)$/,
  matches: ["2.1 Novel Methods", "2 RELATED WORK", "3 X-BRIDGES METHOD", "2.3 3D Printing Manipulation with FDM", "3.2. Results", "A.1 Proof of Lemma 3", "4.3.1 Loose. Using the same material"],
  rejects: ["2.1 of the paper", "A Study of Things", "2021 was a year", "1153 1163", "0.05 N), and the stroke"],
});
export const MENTION_SECTION = rule({
  id: "mention.section", stage: "mention",
  summary: "\"Section\", \"Sec.\", \"Sect.\" or \"§\" followed by one or more section numbers (\"Section 2.1\", \"Sections 3 and 4\", \"§§2–4\") mentions each of them.",
  why: "Papers point the reader to their own sections as often as to their figures; the mention becomes a link to the heading.",
  pattern: /(?<kind>\b(?:Sections?|SECTIONS?|Sects?\.|Secs?\.)|§§?)\s*(?<list>(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3}(?:\s*(?:,|,?\s*and|,?\s*&|[-–—]|to)\s*(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3})*)/,
  matches: ["(Section 2.1)", "in Section 2.3.", "Sections 3 and 4", "Sec. 4.2", "see §3.1", "Section A.2"],
  rejects: ["this section", "Section", "the sections below"],
});

// --------------------------------------------------------------- footnotes

export const FOOTNOTE_NOTE = rule({
  id: "footnote.note", stage: "footnote",
  summary: "A line smaller than the text that opens with a raised number and then words, with nothing at the text's size under it in its column, is a footnote; the lines under it at its size, up to the next such line, are the rest of it.",
  why: "A footnote is set at the foot of its page, smaller than the text, numbered by a superscript — the same number that marks the place in the text it annotates.",
});
export const FOOTNOTE_MARKER = rule({
  id: "footnote.marker", stage: "footnote",
  summary: "A raised number in a line of the text, whose footnote is on the same page, marks that footnote — unless the paper cites with raised numbers and this one is a citation.",
  why: "A reader follows a footnote mark to its note (ACM's \"linear neurons¹\"); Nature-style papers raise their citation numbers too, and those stay citations.",
});

// ------------------------------------------------------------ bibliography

export const BIB_HEADING = rule({
  id: "bibliography.heading", stage: "bibliography",
  summary: "A line that is only \"References\", \"Bibliography\", \"References and Notes\" or \"Literature Cited\" (numbered or not) heads a bibliography.",
  why: "Nearly every paper names its bibliography with one of these words on a line of its own.",
  pattern: /^\s*(?:(?:\d+|[A-Z]|[IVX]+)\.?\s+)?(?:References|REFERENCES|Reference List|Bibliography|BIBLIOGRAPHY|References and Notes|REFERENCES AND NOTES|Literature Cited|LITERATURE CITED|Works Cited|Cited Literature)\s*:?\s*$/,
  matches: ["References", "REFERENCES", "7 References", "Bibliography", "References and Notes", "A. References"],
  rejects: ["References 45", "the references", "References are listed", "Main references cited", "Reference"],
});
export const BIB_STOP = rule({
  id: "bibliography.stop", stage: "bibliography",
  summary: "A heading for an appendix, the methods, acknowledgements or the like ends the bibliography above it.",
  why: "Nature papers put Methods after the references; ACM and LIPIcs papers put appendices after them.",
  pattern: /^\s*(?:(?:(?:\d+|[A-Z]|[IVX]+)(?:\.\d+)*\.?\s+)?(?:Appendix|APPENDIX|Appendices|APPENDICES|Supplementary|SUPPLEMENTARY|Supplemental|Acknowledg(?:e)?ments?|ACKNOWLEDG(?:E)?MENTS?|Methods|METHODS|Author [Cc]ontributions|Competing [Ii]nterests|Additional [Ii]nformation|Extended [Dd]ata|Data [Aa]vailability|Code [Aa]vailability|Index|INDEX|Online content|Reporting summary)\b)/,
  matches: ["Appendix A", "Methods", "Acknowledgements", "Author contributions", "APPENDIX", "B Supplementary proofs"],
  rejects: ["methods in the literature have", "index of refraction"],
});
export const BIB_EDITORIAL = rule({
  id: "bibliography.editorial", stage: "bibliography",
  summary: "A line giving when the paper was received (and accepted) ends the bibliography, however it is set.",
  why: "ACM journals print \"Received 2025-03-26; accepted 2025-08-12\" in plain type straight after the last entry.",
  pattern: /^\s*Received:?\s+(?:\d{4}-\d\d-\d\d|\d{1,2}\s+\p{L}+\s+\d{4}|\p{L}+\s+\d{1,2},?\s+\d{4})/u,
  matches: ["Received 2025-03-26; accepted 2025-08-12", "Received 17 October 2012; revised", "Received March 3, 2020"],
  rejects: ["Received wisdom holds that", "Mako Bates. 2025. Received types"],
});
export const BIB_QUALITY = rule({
  id: "bibliography.quality", stage: "bibliography",
  summary: "A stretch under a bibliography heading is kept only if it reads as a bibliography: at least three entries, most of them with a year.",
  why: "A book's table of contents lists \"Bibliography\" on a line of its own, and what follows it there is chapter titles.",
});
export const BIB_TRAILING_LIST = rule({
  id: "bibliography.trailing-list", stage: "bibliography",
  summary: "Without a heading, a run of at least five lines near the end numbered 1., 2., 3. … in order is a bibliography.",
  why: "Some journal PDFs (PNAS, Nature Communications) set the list without a heading, or with the heading as an image.",
});

// ----------------------------------------------------------------- entries

export const ENTRY_BRACKET = rule({
  id: "entry.bracket", stage: "entry",
  summary: "A line beginning with a bracketed number, [12], begins entry 12.",
  why: "IEEE, ACM numeric and many LaTeX styles (plain, abbrv) number entries in brackets.",
  pattern: /^\s*\[(?<number>\d{1,4})\]\s*/,
  matches: ["[12] Mako Bates", "[1] A. Author"],
  rejects: ["[a] note", "12] Bates", "[ACM19] Label"],
});
export const ENTRY_NUMBER = rule({
  id: "entry.number", stage: "entry",
  summary: "A line beginning with a number and a full stop (or bracket), \"12. \", begins entry 12 when the numbers run in order.",
  why: "Nature, Science, PNAS and Springer journals number entries \"1.\"; the order check keeps a stray \"12. Springer\" from starting one.",
  pattern: /^\s*(?<number>\d{1,3})[.)]\s+(?=\S)/,
  matches: ["1. Kresling, B. Origami", "12) Liu, K."],
  rejects: ["1.5 mm", "2020. Title", "12.3 Section"],
});
export const ENTRY_NUMBER_BARE = rule({
  id: "entry.number-bare", stage: "entry",
  summary: "A line beginning with a bare number and a capital, \"2 Andreas Abel\", begins entry 2 when the numbers run in order.",
  why: "LIPIcs numbers its bibliography with bare numbers in a margin column.",
  pattern: /^\s*(?<number>\d{1,3})\s+(?=[\p{Lu}“"‘'])/u,
  matches: ["2 Andreas Abel and Brigitte Pientka.", "12 “Run-time irrelevance"],
  rejects: ["2020. Title", "12.3 Section", "3 cm long"],
});
export const ENTRY_LABEL = rule({
  id: "entry.label", stage: "entry",
  summary: "A line beginning with a bracketed alphanumeric label, [Knu84], begins the entry cited by that label.",
  why: "alpha-style LaTeX bibliographies label entries by author initials and year.",
  pattern: /^\s*\[(?<label>[A-Z][A-Za-z0-9+.'’-]{1,24}(?:\s?[A-Za-z0-9+]{0,4})?)\]\s*/,
  matches: ["[Knu84] D. Knuth", "[ABC+19] Author"],
  rejects: ["[12] Bates", "[see] text"],
});
export const ENTRY_HANGING = rule({
  id: "entry.hanging", stage: "entry",
  summary: "In an unnumbered list with a hanging indent — learned as the commonest step from one line's left edge to the next's — a line starting at a left edge that such a step leads away from begins an entry.",
  why: "ACM author–year, Springer and APA bibliographies set each entry's first line out and indent the rest.",
});
export const ENTRY_GAP = rule({
  id: "entry.gap", stage: "entry",
  summary: "In an unnumbered list with no indent to go by, a line set below a gap wider than the list's line spacing begins an entry.",
  why: "Some styles separate entries only by space.",
});

// ------------------------------------------------------------------ fields

export const FIELD_DOI = rule({
  id: "field.doi", stage: "field",
  summary: "A DOI is 10., a registrant code of four to nine digits, a slash and a suffix.",
  why: "A printed DOI names the work exactly, and is the first thing a reference is looked up by.",
  pattern: /\b(?<doi>10\.\d{4,9}\/[^\s"<>]+)/,
  matches: ["doi:10.1145/3729296", "https://doi.org/10.2168/LMCS-7(2:4)2011"],
  rejects: ["10.5 mm", "version 10.1"],
});
export const FIELD_YEAR_PAREN = rule({
  id: "field.year-paren", stage: "field",
  summary: "A year in parentheses, (2012), is the entry's year.",
  why: "Nature, Science and APA put the year in parentheses.",
  pattern: /\((?<year>1[5-9]\d\d|20\d\d)(?<suffix>[a-z])?\)/,
  matches: ["Mech. 46, 377–380 (1979).", "Smith, J. (2019a). Title"],
  rejects: ["(1979–1980 edition)", "(12)"],
});
export const FIELD_YEAR_AFTER_AUTHORS = rule({
  id: "field.year-after-authors", stage: "field",
  summary: "A year standing as its own sentence after the authors, \"… Near. 2025. Title\", is the entry's year.",
  why: "ACM's reference format puts the year right after the author list.",
  pattern: /(?:^|[.,]\s)(?<year>1[5-9]\d\d|20\d\d)(?<suffix>[a-z])?\.\s/,
  matches: ["Joseph P. Near. 2025. Efficient, Portable", "Abel and Thierry Coquand. 2007a. Untyped"],
  rejects: ["pages 2025–2030.", "vol. 12. 1999x"],
});
export const FIELD_YEAR_ANY = rule({
  id: "field.year-any", stage: "field",
  summary: "Otherwise, the last four-digit number that could be a year is the entry's year.",
  why: "IEEE and Springer styles put the year near the end.",
  pattern: /\b(?<year>1[5-9]\d\d|20\d\d)(?<suffix>[a-z])?\b/g,
  matches: ["Proc. POPL, 2013."],
  rejects: ["pages 123–145"],
});
export const FIELD_AUTHORS_INVERTED = rule({
  id: "field.authors-inverted", stage: "field",
  summary: "Authors given surname first, \"Liu, K., Tachi, T. & Paulino, G. H.\", end at the last initials; the title follows.",
  why: "Nature, Science and many journals list authors surname first with initials.",
  pattern: /^(?<authors>(?:(?:de |van |von |van der |de la )?[\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?,\s(?:[\p{Lu}]\.\s?-?)+(?:,\sand\s|,\s&\s|\sand\s|\s&\s|,\s)?)+(?:\s?et al\.)?)\s*(?<rest>.*)$/u,
  matches: ["Kresling, B. Origami-structures in nature", "Liu, K., Tachi, T. & Paulino, G. H. Invariant and smooth", "Zheng, J. P. et al. Focusing micromechanical", "Maler, E., and Yergeau, F. Extensible Markup"],
  rejects: ["Mako Bates, Shun Kashiwa. 2025. Efficient", "A. Author, B. Author, Title"],
});
export const FIELD_AUTHORS_YEAR_FIRST = rule({
  id: "field.authors-year-first", stage: "field",
  summary: "Authors ended by the year, \". YEAR.\" (ACM) or \"(YEAR)\" (APA, SAGE): the title follows the year.",
  why: "ACM, APA and SAGE reference formats put the year straight after the authors.",
  pattern: /^(?<authors>.+?)[.,]?\s\(?(?<year>1[5-9]\d\d|20\d\d)(?<suffix>[a-z])?\)?[.,]?\s(?<rest>.*)$/,
  matches: ["Mako Bates, Shun Kashiwa, and Joseph P. Near. 2025. Efficient, Portable", "Smith, J. (2019). A title.", "Chen J, Miao X, Ma H, et al. (2024) Intelligent mechanical"],
  rejects: ["Kresling, B. Origami-structures in nature. MRS 1420 (2012)"],
});
export const FIELD_TITLE_QUOTED = rule({
  id: "field.title-quoted", stage: "field",
  summary: "A title in quotation marks, “Title,”, is the entry's title.",
  why: "IEEE style quotes titles.",
  pattern: /[“"](?<title>[^”"]{8,300}?)[,.]?[”"]/,
  matches: ["A. Author, “Deep learning for origami,” in Proc."],
  rejects: ["A. Author, Deep learning. In Proc."],
});

// ---------------------------------------------------------------- citations

const NUMBER_ITEM = "\\d{1,4}(?:\\s*[-–—]\\s*\\d{1,4})?";
export const CITE_BRACKET = rule({
  id: "citation.bracket", stage: "citation",
  summary: "Bracketed numbers, [3], [1, 4–6], [12, p. 4], cite those entries of a numbered bibliography.",
  why: "IEEE, ACM numeric and most LaTeX numeric styles.",
  pattern: new RegExp(`\\[(?<list>\\s*${NUMBER_ITEM}(?:\\s*[,;]\\s*${NUMBER_ITEM})*)(?<locator>\\s*,\\s*(?:p|pp|Sec|Section|Ch|Chap|Chapter|Thm|Theorem|Lemma|Def|Definition|Fig|Figure|Prop|Cor|Example|Ex)\\.?\\s*[\\w.–-]+)?\\s*\\]`),
  matches: ["shown in [12], and", "[1, 4–6]", "[3-5]", "[12, p. 4]", "[40; 41]", "[18, Section 3]"],
  rejects: ["[a]", "[Knu84]", "[x, y]", "[0.5, 1]"],
});
export const CITE_PAREN = rule({
  id: "citation.paren", stage: "citation",
  summary: "Numbers in parentheses, (3), (1, 4–6), cite those entries where the paper cites that way and nothing marks them as an equation's number.",
  why: "PNAS and some Science journals cite with parenthesized numbers.",
  pattern: new RegExp(`\\((?<list>\\s*${NUMBER_ITEM}(?:\\s*,\\s*${NUMBER_ITEM})*)\\s*\\)`),
  matches: ["response (36), and", "(1, 2)", "(4–7)"],
  rejects: ["(a)", "(2.5)"],
});
export const CITE_SUPERSCRIPT = rule({
  id: "citation.superscript", stage: "citation",
  summary: "Superscript numbers after a word, 22,23 or 25–27, cite those entries where the paper cites that way — but not after a digit, a unit, a variable (one italic letter), a function (sin, cos, log) or a closing bracket on a line of mathematics, nor on a first page's line of names.",
  why: "Nature, Science and Wiley journals; the exceptions are powers (m², x₀², (h/b)²) and authors' affiliation marks.",
  pattern: new RegExp(`^(?<list>${NUMBER_ITEM}(?:\\s*,\\s*${NUMBER_ITEM})*),?$`),
  matches: ["22,23", "25–27", "4", "7–9,12"],
  rejects: ["a", "2.5", "−1"],
});
export const CITE_AUTHOR_YEAR_GROUP = rule({
  id: "citation.author-year-group", stage: "citation",
  summary: "Authors and years in brackets or parentheses, [Sweet et al. 2023], (Smith and Doe, 2019; Lee 2020a), cite the entries by those first authors in those years.",
  why: "ACM author–year, APA, Chicago and natbib's round and square author–year styles.",
  pattern: /[[(](?<group>(?:(?:see|See|e\.g\.|cf\.|i\.e\.|and|also)[,]?\s+)*(?:(?:van|von|de|der|den|du|la|le|da|di|del|dos|ten|ter)\s+)*[\p{Lu}][^[\]()]{0,300}?\b(?:1[5-9]\d\d|20\d\d)[a-z]?\b[^[\]()]{0,120})[\])]/u,
  matches: ["[Sweet et al. 2023]", "[Hirsch and Garg 2022]", "[Annenkov et al. 2019, Section 2.5.3]", "(Smith et al., 2019; Doe 2020)", "(e.g., Lee 2020a, b)", "[see, e.g., Carbone et al. 2014; Lanese et al. 2013]", "[van den Bos and Jongmans 2023]"],
  rejects: ["[12]", "(2019)", "(see Section 3)"],
});
export const CITE_AUTHOR_YEAR_NARRATIVE = rule({
  id: "citation.author-year-narrative", stage: "citation",
  summary: "A name followed by years in brackets or parentheses, Sweet et al. [2023] or Smith (2019a, b), cites that author's entries of those years.",
  why: "The narrative form of every author–year style.",
  pattern: /(?<names>\b[\p{Lu}][\p{L}'’-]+(?:\s(?:et\sal\.|and\s[\p{Lu}][\p{L}'’-]+|&\s[\p{Lu}][\p{L}'’-]+))?)\s[[(](?<years>(?:1[5-9]\d\d|20\d\d)[a-z]?(?:\s*[,;]\s*(?:(?:1[5-9]\d\d|20\d\d)[a-z]?|[a-z]\b))*)[\])]/u,
  matches: ["Sweet et al. [2023]", "Smith (2019a, b)", "Hirsch and Garg [2022]"],
  rejects: ["in (2019)", "and [2023]"],
});

// Capitalized words that stand before a year in brackets without being
// anyone's name: "Section (2019)" is not a citation of Section.
export const NOT_A_NAME = new Set([
  "Section", "Sections", "Figure", "Figures", "Fig", "Table", "Tables", "Equation", "Eq", "Chapter", "Theorem", "Lemma",
  "Definition", "Appendix", "Example", "Proposition", "Corollary", "Algorithm", "Page", "Volume", "Vol", "In", "See",
  "The", "This", "These", "Since", "From", "Until", "Before", "After", "Year", "Version", "Release", "January", "February",
  "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Spring", "Summer",
  "Fall", "Autumn", "Winter", "Proc", "Proceedings", "Journal", "Conference", "Workshop", "Symposium", "Accessed",
]);
export const CITE_LABEL = rule({
  id: "citation.label", stage: "citation",
  summary: "Bracketed labels that name entries of an alpha-labelled bibliography, [Knu84, GHV95], cite them.",
  why: "alpha-style LaTeX bibliographies.",
  pattern: /\[(?<list>[A-Z][A-Za-z0-9+.'’-]{1,24}(?:\s*,\s*[A-Z][A-Za-z0-9+.'’-]{1,24})*)\]/,
  matches: ["[Knu84]", "[Knu84, GHV95]"],
  rejects: ["[12]", "[a, b]"],
});

// ---------------------------------------------------------------- header
// The title block on a paper's first page: what the upload form fills in
// when no index knows the paper (src/rules/header.ts).

export const HEADER_TITLE = rule({
  id: "header.title", stage: "header",
  summary: "The title is the largest text in the top two thirds of the first page, larger than the body, with the lines set in that size directly under it.",
  why: "Every publisher sets the title as the page's largest words; a CHORUS or arXiv cover line above it is set smaller.",
});
export const HEADER_NOT_TITLE = rule({
  id: "header.not-title", stage: "header",
  summary: "A banner, a notice or an identifier line is never the title, however large it is set.",
  why: "Accepted manuscripts open with \"This is the accepted manuscript…\", journals with \"ARTICLE\" or \"Open access\", and some set these large.",
  pattern: /^\s*(?:this is (?:the|an) |accepted manuscript|research article|article$|articles?\s*\||letter$|review article|open access|original (?:research|article)|check for updates|arxiv:|doi:?\s|https?:\/\/|www\.|received\b|published\b|copyright|©|proceedings of|journal of|vol(?:ume|\.)\s*\d|contents lists)/i,
  matches: ["This is the accepted manuscript made available via CHORUS.", "ARTICLE", "Check for updates", "arXiv:2411.15100v2 [cs.CL] 22 Nov 2024", "https://doi.org/10.1038/s41586-021-03623-y"],
  rejects: ["Mechanical computing", "Articulated origami", "Letters from the field"],
});
export const HEADER_SUBTITLE = rule({
  id: "header.subtitle", stage: "header",
  summary: "A line set smaller than the title, directly under it, that is neither names nor an affiliation nor prose, is its subtitle.",
  why: "ACM sets a paper's subtitle on its own line under the title, in a smaller size; Crossref has the two joined by a colon.",
});
export const HEADER_RUNNING_TITLE = rule({
  id: "header.running-title", stage: "header",
  summary: "Where the first page has no title in text, the running head of the next pages that is not a page number, a journal or the names is the title.",
  why: "A scanned paper (Lamport's Byzantine Generals) has its title as a picture but the journal's running head in text.",
});
export const HEADER_MASTHEAD = rule({
  id: "header.masthead", stage: "header",
  summary: "An Elsevier masthead — \"Contents lists available at ScienceDirect\" over the journal's name over \"journal homepage\" — names the journal, and nothing in it is the title.",
  why: "Elsevier sets the journal's name larger than the paper's title.",
  pattern: /contents lists available at|journal homepage\s*:/i,
  matches: ["Contents lists available at ScienceDirect", "journal homepage: www.elsevier.com/locate/cag"],
  rejects: ["Computers & Graphics"],
});
export const HEADER_CITE_THIS = rule({
  id: "header.cite-this", stage: "header",
  summary: "A cover sheet's \"To cite this article:\" line names the authors and the year, before the title's own page.",
  why: "IOP Publishing puts a cover sheet with other papers' names in \"You may also like\" before the paper; its citation line is the one to trust.",
  pattern: /to cite this article\s*:\s*(?<authors>.+?)\s+(?<year>(?:19|20)\d\d)\b/i,
  matches: ["To cite this article: David H Wolpert and Jan Korbel 2026 J. Phys. Complex. 7 015001"],
  rejects: ["View the article online for updates and enhancements."],
});
export const HEADER_AUTHORS = rule({
  id: "header.authors", stage: "header",
  summary: "The authors are the names in the lines under the title, before the abstract: separated by commas, \"and\", \"&\", affiliation marks or a wide gap, each two to five capitalized words or initials.",
  why: "ACM sets one \"NAME, Affiliation\" per line, Nature a comma list with superscript affiliations, ML papers names apart with only their marks between.",
});
export const HEADER_AFFILIATION = rule({
  id: "header.affiliation", stage: "header",
  summary: "A part of an author line that names an institution, a place or an address is an affiliation, not a person.",
  why: "Affiliations share the author lines, split by the same commas as the names.",
  pattern: /\b(?:univ(?:ersit[a-zé]+|\.)|institut[a-z]*|inst\.|department|dept\b|school|college|laborator[a-z]+|lab|labs|cent(?:er|re)|academy|hospital|faculty|research|corporation|inc|ltd|gmbh|technolog[a-z]+|sciences?|engineering|polytechni[a-z]+|eth|epfl|mit|csail|cnrs|inria|max planck|microsoft|google|deepmind|meta|nvidia|amazon|ibm|intel|apple|sri international|usa|u\.s\.a|united (?:states|kingdom)|uk|china|japan|germany|france|canada|korea|italy|spain|switzerland|netherlands|australia|singapore|israel|india|sweden|denmark|austria|belgium|email|e-mail)\b|@/i,
  matches: ["Yale University", "USA", "Department of Mechanical Engineering", "Max Planck Institute for Software Systems", "SRI International", "Carnegie Mellon University", "MIT CSAIL"],
  rejects: ["Yuting Wang", "Hiromi Yasuda", "Philip R. Buskohl", "Marshall Pease"],
});
export const HEADER_ABSTRACT = rule({
  id: "header.abstract", stage: "header",
  summary: "The author block ends at the abstract: its heading, or a line of running prose.",
  why: "Below the names come affiliations, then the abstract; nothing in or after the abstract is an author.",
  pattern: /^\s*(?:abstract|a b s t r a c t|a r t i c l e|summary|introduction|keywords|key words|index terms|ccs concepts|categories and subject descriptors|general terms|additional key words|1\.?\s+introduction)\b/i,
  matches: ["ABSTRACT", "Abstract—We present", "1 INTRODUCTION", "CCS Concepts: • Software", "a r t i c l e i n f o", "Additional Key Words and Phrases: Interactive consistency"],
  rejects: ["Abstracting away the stack", "Arthur Azevedo de Amorim"],
});
export const HEADER_JOURNAL_LINE = rule({
  id: "header.journal-line", stage: "header",
  summary: "A running line that gives a journal's name, then its year or volume — \"Nature Communications | (2024)15:3510\", \"Nature | Vol 598\" — names the journal and its year.",
  why: "Nature's journals print the citation of the paper in every page's footer or header.",
  pattern: /^\s*(?<journal>[A-Z][A-Za-z&.' ]{2,60}?)\s*\|\s*(?:\((?<year>(?:19|20)\d\d)\)\s*\d|vol(?:ume)?\b)/i,
  matches: ["Nature Communications | (2024)15:3510", "NATURE COMMUNICATIONS | (2019) 10:882 | https://doi.org/10.1038/s41467-019-08678-0", "Nature | Vol 598 | 7 October 2021", "Nature Computational Science | Volume 4 | August 2024 | 567–573"],
  rejects: ["Article | Open access", "Received: 9 July 2023"],
});
export const HEADER_JOURNAL_VOLUME = rule({
  id: "header.journal-volume", stage: "header",
  summary: "A running head in capitals that gives a journal's name, its volume, the page and the year in parentheses names the journal and its year.",
  why: "APS heads every page \"PHYSICAL REVIEW E 100, 063001 (2019)\".",
  pattern: /^\s*(?<journal>[A-Z][A-Z .&:]{5,60}?)\s+\d{1,4},\s*\d+\s*\((?<year>(?:19|20)\d\d)\)/,
  matches: ["PHYSICAL REVIEW E 100, 063001 (2019)", "PHYSICAL REVIEW LETTERS 122, 155501 (2019)"],
  rejects: ["Phys. Rev. Lett. 122, 155501 — Published 19 April 2019"],
});
export const HEADER_PROCEEDINGS = rule({
  id: "header.proceedings", stage: "header",
  summary: "The proceedings an ACM reference paragraph on the first page names — \"In Proceedings of the … (CHI '23)\" — are the paper's venue.",
  why: "ACM conference papers print how to cite them on their first page; the venue there is the name Crossref keeps.",
  pattern: /\bIn (?<venue>Proceedings of the .{10,180}?)\s*\((?:[A-Z]{2,}|[A-Z][a-z]+)\s*['’]\s*\d\d\)/,
  matches: ["2023. All-in-One Print. In Proceedings of the 2023 CHI Conference on Human Factors in Computing Systems (CHI '23), April 23–28, 2023"],
  rejects: ["Proceedings of the ACM on Programming Languages"],
});
export const HEADER_JOURNAL_ABBREVIATION = rule({
  id: "header.journal-abbreviation", stage: "header",
  summary: "A journal's abbreviation printed in a first page's citation line (\"Proc. ACM Program. Lang.\", \"Phys. Rev. Lett.\", \"PNAS\") stands for the journal's name.",
  why: "ACM, APS and PNAS print only the abbreviation; the name is what Crossref and the form keep.",
  pattern: /\b(?<abbr>Proc\. ACM Program\. Lang\.|ACM Trans\. Graph\.|Phys\. Rev\. Lett\.|Phys\. Rev\. [A-Z]\b|PNAS\b|Proc\. Natl\. Acad\. Sci\.)/,
  matches: ["Proc. ACM Program. Lang., Vol. 3, No. POPL, Article 62. Publication date: January 2019.", "Phys. Rev. Lett. 122, 155501 — Published 19 April 2019", "PNAS 2025 Vol. 122 No. 24"],
  rejects: ["Proceedings of the ACM on Programming Languages"],
});
export const HEADER_YEAR_LATE = rule({
  id: "header.year-late", stage: "header",
  summary: "Where no date of publication is printed, the year of a \"YYYY, Vol.\" line or, last, of acceptance.",
  why: "SAGE heads its first page \"2025, Vol. 36(18-19)\"; Nature Communications gives only received and accepted dates on it.",
  pattern: /(?:^|\n)\s*(?<vol>(?:19|20)\d\d),\s*Vol\.|accepted\W{0,3}(?:\d{1,2}\s+)?(?:[A-Z][a-z]+\.?\s+)?(?:\d{1,2},?\s+)?(?<accepted>(?:19|20)\d\d)\b/i,
  matches: ["2025, Vol. 36(18-19) 1266–1268", "Accepted: 16 March 2026", "Accepted 8 April 2024"],
  rejects: ["Received: 9 July 2023"],
});
export const HEADER_YEAR = rule({
  id: "header.year", stage: "header",
  summary: "The year is the one a publication date, a copyright or a published-online line on the first page gives; an arXiv number's own year where there is none.",
  why: "ACM prints \"Publication date: January 2019\", Nature \"Published online: 6 October 2021\", APS \"— Published 19 April 2019\", most a © line.",
  pattern: /(?:publication date|published(?: online)?|available online|©|copyright|\(c\)|Ó the author\(s\))\W{0,3}(?:[A-Za-z]+\.?\s+)?(?:\d{1,2}(?:st|nd|rd|th)?,?\s+)?(?:[A-Z][a-z]+\.?,?\s+)?(?:\d{1,2},?\s+)?(?<year>(?:19|20)\d\d)\b/i,
  matches: ["Publication date: January 2019.", "Published online: 6 October 2021", "Phys. Rev. Lett. 122, 155501 — Published 19 April 2019", "© 2023 Copyright held by the owner/author(s).", "Copyright © 2022 ACM", "Ó The Author(s) 2025"],
  rejects: ["Received: 12 May 2020", "Vol 598 | 7 October 2021"],
});
