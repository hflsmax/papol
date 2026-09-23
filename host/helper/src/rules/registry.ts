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

export type Stage = "layout" | "caption" | "float" | "mention" | "bibliography" | "entry" | "field" | "citation";

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

export const FLOAT_GRAPHICS = rule({
  id: "float.graphics", stage: "float",
  summary: "What a page paints — filled or stroked paths, images — counts towards a float, except a page's background (over half the page), a rule running across the margin, specks under two points each way, and a tint or box behind running text or a running head.",
  why: "Figures are drawn, not typeset; but PDFs also paint white page backgrounds, header rules, tinted running-head bars (a book's chapter band) and shaded text boxes that belong to no figure.",
});
export const FLOAT_CAPTION_PARAGRAPH = rule({
  id: "float.caption-paragraph", stage: "float",
  summary: "A caption goes on for the lines under its first, at its size, each overlapping the ones above and no more than line spacing below them; a second column of it level with its first line, just right of it, belongs to it when the caption is set smaller than the text. A float with nothing found around its caption is its caption.",
  why: "A caption is a paragraph, its label only the first line; centred last lines and Nature's two-column captions under wide figures are still the one paragraph.",
});
export const FLOAT_PROSE = rule({
  id: "float.prose", stage: "float",
  summary: "What ends a float: a line of running text (at the text's size within 8%, 30 characters or more, mostly words, not in a monospaced or mathematics font, no wide gaps between its words) and the short last line of such a paragraph; a heading (bold, at the text's size or above, and numbered, larger, or with running text under it); and every other float's caption.",
  why: "A figure can be text — code, a grammar, rules of inference — or a table whose header is a line of words, so a float cannot stop at the first text; it stops at text that reads as the paper's own prose, and at the next float's caption, which is what keeps stacked figures apart.",
});
export const FLOAT_FRAME = rule({
  id: "float.frame", stage: "float",
  summary: "A drawn rectangle around a caption, several times its size, is the float: its frame.",
  why: "Nature's boxes, and framed listings, are set inside a rule or a tint with the caption at the top.",
});
export const FLOAT_FIGURE_EXTENT = rule({
  id: "float.figure-extent", stage: "float",
  summary: "A figure grows from its caption, upward (downward when nothing is above): a drawing joins when it touches what has grown so far, within three lines up or down or two and a half across, a label or any other text that is not prose within one and a half lines, until nothing more touches, and never across or over prose, a heading, or another float. On a page of two columns of text, a caption in one column keeps its figure in that column.",
  why: "A figure is almost always set above its caption, as panels with gaps between them and labels, arrows and nodes sticking out on every side; growing by touch takes all of them in, and stopping at prose and other captions keeps the neighbours out.",
});
export const FLOAT_SIDE_CAPTION = rule({
  id: "float.side-caption", stage: "float",
  summary: "A figure caption with nothing above or below it, but a drawing level with it up to six lines to the side, is set beside its figure: the figure grows from that drawing, in every direction.",
  why: "Books (Demaine & O'Rourke) set narrow captions in the margin beside the drawing, further from it than a figure's own parts are from each other.",
});
export const FLOAT_TABLE_EXTENT = rule({
  id: "float.table-extent", stage: "float",
  summary: "A table (or algorithm, or listing) grows like a figure but downward first, and out of text and the thin rules between it only; tables are sized before figures, and a figure grows around them.",
  why: "Tables are captioned above themselves and are text and rules; a picture under a table is the next figure's, which otherwise took the table's rows as its own.",
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
