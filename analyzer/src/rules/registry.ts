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

export type Stage = "layout" | "caption" | "float" | "section" | "footnote" | "statement" | "rule" | "mention" | "bibliography" | "entry" | "field" | "citation" | "header";

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
  summary: "A run smaller than its line and raised (or lowered) against it is a superscript (or subscript) of that line (a lone bracket, brace or bar stretched over a stack of lines bases none, and stands apart from the text beside it), unless it is a word of three letters or more set a quarter of the line's size or more past the line's end, or one raised over a big operator set alone from before its start and off its middle (a superscript follows its base, a limit is centred on its operator), or a word of five letters or more against a line holding no letter (a symbol some fonts draw at a huge size); touching two lines alike, it belongs to the nearer baseline. Scripts bridge a blank on a baseline only where they fill it without a gap wider than a word space. A line whose own runs hold no letter but whose scripts do (a big operator) reaches up and down no further than 1.5 times its scripts' size. A period set larger than a letter and over it (an accent some fonts draw as a period) is no text of any line.",
  why: "Nature, Science and Wiley papers cite with superscript numbers glued to the word before them; consistent subtyping sets CS-TVar a space past its conclusion, raised to the bar, in smaller type; RapunSL sets Pₓ's subscript against the ⨁ under it, and two rules' subscripts either side of the blank between them; a verified scheduler's specifications stretch a brace to 106pt over ten lines of 10pt text, which are no scripts of it; VerusBelt sets its laws' names over and under a ∗ its font reads as 24pt; Melocoton sets FREE-C over its formula's big ∗, which rises to the label's baseline; MoSeL's ⁎, read as 34pt, would reach into the paragraphs round it; ExoTerra dots ẋ and ė with an 11pt period over 8pt letters, which bridged a formula to the label level with it (\". (TCTX)\") and based TyVar's conclusion as a script under its bar.",
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
export const LAYOUT_COLUMN = rule({
  id: "layout.column", stage: "layout",
  summary: "Blank space wider than the size (a quad) between two runs on one baseline opens a column where a line just above or below (within two and a half sizes) leaves a blank of the size there too, its text before the blank starting where this line's does and its text after starting where the right run does: a grid. A lone character after the blank stays on the line (\"Interchange 1\" over \"Interchange 2\").",
  why: "OOPSLA's bottom-up linearization sets three labelled equations side by side a word space apart; read as one line, [MergeIdempotence] and [MergeCommutativity] are one label and the equations under them one line. The caption under the figure crosses the gap, so it is no gutter. An aligned display (\"Θ₁ = …\" over \"Θ₂ = …\") is a grid too, but its blank is under a quad and stays one line.",
});
export const LAYOUT_RULES_APART = rule({
  id: "layout.rules-apart", stage: "layout",
  summary: "Blank space wider than half the size between two runs on one baseline parts them where one level stroke at least three sizes long ends in the blank and another level with it starts there, within two sizes of the baseline: two rules set side by side, each line its own rule's premise or conclusion.",
  why: "Featherweight Go sets T-Assert_I, T-Assert_S and T-Stupid a word space apart, their premises one baseline; read as one line, the premises of both rules run past each rule's bar and neither label finds its rule.",
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
export const LAYOUT_UNDERSCORE = rule({
  id: "layout.underscore", stage: "layout",
  summary: "A blank between two runs, or a space in one, that a short stroke fills at the baseline (a fifth to four fifths of the size wide) is an underscore.",
  why: "Polymorphic Contracts and its JFP version set E_Beta in small capitals and draw the underscore as a stroke; read as a space, the name is \"E Beta\" and its mentions in the text never match.",
});
export const LAYOUT_SMALL_CAPS = rule({
  id: "layout.small-caps", stage: "layout",
  summary: "A run on one baseline joins the line of the run it touches when their sizes are within a quarter of each other, even where the baseline's first run is further off in size.",
  why: "Small capitals faked from a text font set \"LT-V\" at 8pt and \"AR\" at 6.4pt on a row that opens with 9pt mathematics; the name is one word.",
});

export const LAYOUT_LIGATURE = rule({
  id: "layout.ligature", stage: "layout",
  summary: "A glyph the font names as a ligature of letters (its parts joined by \"_\", each a letter's name with any suffix: q.sc_u.sc, f_f_i) spells all of them, where the text layer maps it to fewer.",
  why: "Libertine sets the small-capital \"qu\" as one glyph whose ToUnicode entry is \"q\": UNIQUE read as \"uniqe\", F-CONSEQUENCE as \"F-conseqence\", and a name no one would type.",
});
export const LAYOUT_FONTS = rule({
  id: "layout.fonts", stage: "layout",
  summary: "A run whose own font's glyphs do not spell it is placed by every font's glyphs in the order drawn: pdf.js names one font for text drawn in several.",
  why: "\"(uniqe)\" is reported in its brackets' font while the name is drawn in small capitals: the other font's widths put small-capital mentions a letter left, clipping their last letter, and left the ligature unread.",
});
export const LAYOUT_BLANKS = rule({
  id: "layout.blanks", stage: "layout",
  summary: "A run's glyphs keep their widths at the size drawn and its blanks take what is left of its width, unless a blank would shrink under half its own width; then the whole is stretched evenly.",
  why: "In \"; // RD-Lock\" a narrow gap stretched with every glyph put the R a point right of where it is printed; faked small capitals (\"S EMPTY\" with MPTY smaller) are not at one size.",
});
export const LAYOUT_SMALL_CAPITALS = rule({
  id: "layout.small-capitals", stage: "layout",
  summary: "A lowercase letter is a small capital where its glyph is named one (u.sc, a.smcp) or its font is set in them (cmcsc).",
  why: "Small capitals reach the text layer as lowercase: the rule DUAL and the word \"dual\" read the same until the glyphs say which is which.",
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
export const CAPTION_NOT_WRAPPED = rule({
  id: "caption.not-wrapped", stage: "caption",
  summary: "A line that would begin a caption is not one when the line a leading above it, at its edge and its size, runs on into it without ending a sentence: a mention the paragraph wrapped onto the start of a line.",
  why: "Geometric Folding Algorithms wraps \"…as indicated in / Table 1.1. Before embarking…\"; taken for Table 1.1's caption, it also hid the real one, since a number's first caption is the float's.",
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
  summary: "A float is everything that starts between its caption and the first bound on its side — running text or a heading (bold, or a subsection's number with an italic lead run in to its paragraph) over or under the caption itself (beside it, it is text wrapped around the float), another caption, a float already sized — across the columns the caption is set across (and the caption, where it hangs into the margin), shared halfway with a caption level with it. No distance limits it: a figure can be any height, with any space inside it.",
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
export const FLOAT_SCANNED = rule({
  id: "float.scanned", stage: "float",
  summary: "On a scanned page — one picture covering it, its text laid over — a float with any pieces in its band is the whole band, across its columns, from the bound (or the page's margin) to its caption.",
  why: "A scanned drawing's strokes are in the page's picture, where nothing sees them; only its OCR'd labels were pieces, and the box sat inside the drawing (Lamport, Shostak and Pease, Fig. 1).",
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

// ------------------------------------------------------------------ rules

// The shapes a rule's name may take. Small capitals reach the text layer
// as capitals or in lowercase by font, so a name is matched without
// regard to case, and a wholly lowercase prefix is kept short (accented
// letters as in naïve-⊕PL).
// A part is letters and digits, or connectives, and may end in a sign
// (WF-var+, Rel-Fun±, S-Trans′); parts are joined by a hyphen, a colon
// or a slash (T:Proc, Step/Seq, Program_E).
// The connectives a symbol name is made of, or a part of a hyphenated
// name may be (→L, ×T, Sem-⊤, ≤-Base, Prf-⊃-Intro); linear logic's
// exponentials among them (?R, !L).
export const RULE_CONNECTIVES = "→⇒⇓⇛⇝↪⤳∀∃⊢⊣⊨⊩⊗⊕⊸⊠∧∨¬<:=≤≥≼≽⪯⪰⊑⊒⊂⊃⊆⊇×+&∼~⋍≃≈≡⊲⊳▷◁⊤⊥∂⋆∘?!";
// The modalities of a modal logic open a name or make a part of one
// before or after a hyphen (□-Mono, ⊡-Intro, Iris-□-Intro); alone, a box
// ends a proof, so they are no connectives.
export const RULE_MODALITIES = "□◇⊡";
// An arrow, a proportionality or a flat opens a name before a hyphen as
// a modality does (a relational modal logic's ↑-EXPAND and ∝-INTRO,
// Cartesian Hoare Logic's ♭-intro 1), and nowhere else in it (T-↑↑ is
// no name); so do a separating conjunction's star and, a minus before
// it, the magic wand (MoSeL's BI axioms ∗-mono, −∗-intro and −∗-elim).
export const RULE_OPENERS = "∝↑↓♭∗*";
// A part may end in a sign (WF-var+, Effect-L-★, S-NTerm-↑), and join
// capitalised pieces with a plus (M-PropW+NTW, an x86 model's
// propagation of writes and non-temporal writes together).
const RULE_SIGN = "(?:[+−±†‡♠♣♦*∗★?!↓↑↕'′’-]{1,2})";
const RULE_PART = "(?:\\p{L}*\\p{Ll}\\p{L}*(?:\\+\\p{Lu}[\\p{L}\\d]*)+|[\\p{L}\\d][\\p{L}\\d'′’]*" + RULE_SIGN + "?|(?:[" + RULE_CONNECTIVES + RULE_MODALITIES + "*∗|/]|\\{\\})+[\\p{L}\\d" + RULE_CONNECTIVES + RULE_MODALITIES + "*∗|/'′]*|⟨\\p{Ll}{1,8}⟩)";
export const RULE_NAME = "(?:[A-Z][\\p{L}]{0,19}\\d{0,2}|[a-zà-öø-ÿ]{1,8}|[a-z]{1,3}(?:\\|[a-z]{1,3})+|[a-z]{1,8}(?:[A-Z][a-z]{0,8}){1,2}\\d{0,2}|\\p{Script=Greek}{1,2}|[" + RULE_CONNECTIVES + RULE_MODALITIES + "]{1,2}\\d?|(?:[−-](?=[∗*]))?[" + RULE_OPENERS + "]|⟨\\p{Ll}{1,8}⟩)(?:(?:[-‐‑–−:/_]" + RULE_PART + ")+|-[★↑↓↕])(?: \\([\\p{L}\\d]{1,4}\\)|\\((?!\\p{Ll})[\\p{L}\\d]{1,4}\\)| \\[[A-Z]{1,2}\\])?";

export const RULE_CANDIDATE = rule({
  id: "rule.candidate", stage: "rule",
  summary: "A line that is one token, or that opens or ends with one an em or more apart from the rest (or set off by a colon, which ends it after a letter, or making up its line with a period after it, letters and hyphens only; so closed it labels a rule only at a bar; a hyphenated name heading its line, the rest a note of two words or more in parentheses set in its face, is the whole line's), may label a rule: up to 48 characters with no inner space (one between a one- or two-letter prefix and a capitalised word, before a trailing capital, digit or arrow, or before a parenthesised tag), a letter in it, opening with a letter, a digit or a symbol name's connective (\"→L\", \"<:eq\"), brackets that pair, not a number, a citation or a formula (every letter mathematical, or the first read from a symbol font: the ⟦ ⟧ of a denotation; after a connective, letters all mathematical with no capital among them, or all lowercase in an italic face, its sub- and superscripts aside: ⊕𝜎𝑓, × 1/fps, !h_I), nor a proof step's justification opening with a preposition (\"By IH\", \"By 18\") or a bare keyword of a clause or side condition (\"where\", \"otherwise\"). A piece of a large brace set at a token's end is no letter of it. A modality opens a token only before a hyphen (□-mono, ⟨affine⟩-intro) or an upright capital (□I), as do an arrow, a proportionality, a flat, a separating conjunction's star and a magic wand before a hyphen or a minus (↑-EXPAND, ∝-INTRO, ♭−intro 1, ∗-mono, −∗-intro), and a modality's word in angle brackets stands between two hyphens (tac-⟨obj⟩-intro), and a connective there may stand a space from it (⇒ -I), Iris's |⇛ with its bar; a raised mark may stand inside a name before a letter (stacks•IN-unique); a token may end in a hash and a number (CALLBACKREG#1), a star (effect-l-★) or a spaced capital in square brackets (Ht-listen [S]); in brackets, a connective hyphened to one or two letters is a name whatever face the letters take (𝜇-<:-𝜇). A symbol font's glyph the PDF leaves as its code is read as the glyph: stmary's □ and ⊡, msam's □, cmsy's ≼, mathabx's prime read as \"1\" (R11 is R1′), and, opening a word before a hyphen or a minus, lasy's □ read as \"2\", cmmi's ▷ read as \".\" and its ♭ read as \"[\" (2-INTRO is □-INTRO). A TeX symbol font's capital opening a name before a hyphen is a calligraphic letter (𝓛-WEAKEN). A spacing accent the PDF sets after its letter or at the word's end, a space before it maybe, is put back on the character under it (\"LOB¨\" and \"L ¨OB\" are LÖB, txsys's \"¤\" is the dot over ⇛); among mathematical letters it is a formula's. A capital with two digits is a rule's number (R10), in square brackets a citation's key. A period ends a label after a word or an exponential before a capital (\"!W.\"). In brackets making up its line, a capitalised word of three letters or more in math italic, or one in capitals at a bar where a word spelled so in brackets stands on its page, is a name ((𝑀𝑒𝑡ℎ𝑜𝑑), (𝐴𝑃𝐼) over (𝑆𝑒𝑞)); elsewhere capitals tag a goal ((𝐺𝑂𝐴𝐿) among (1) and (2)). A name a blank before a colon, the blank wider than twice the one after it, declares a law's type in a listing aligning its colons (\"∗-swap   : ∀[ …]\"): no label. A label the layout ran into a conclusion as its superscript (\"}(D-∀)\") is split off, one whose closing bracket or last piece it set apart (\"(T-∀-E𝑝\" and \")\", \"(stacks•\" and \"IN-unique)\") is joined. A number set left of the text on a token's line numbers the line (a review copy's) and is split off. The size a label is measured against is the text's, or the size most lines of a prose line's length are set in where that is larger; a line under 0.55 of it is a diagram's lettering (Sparse Workspaces labels a matrix's levels \"(Level J)\" at half the text's size). A bracketed token ending a formula shorter than a line of prose (or longer, a relation in it and fewer than two words of prose), on its baseline at another size than the line, is set apart by its size: a fifth of an em will do, and no space need stand before its bracket (\"𝑇1(∧1-<:)\"). A bracketed token at a smaller size ending a formula of any length (no sentence: two lowercase words or more), even with no blank read before it, is set apart by its size; a formula's last mathematical letter read with a bracketed name after it as a tagged name (\"𝜏 (Tvar)\") leaves the bracketed one the label. A name in capitals throughout ending a formula set in the math fonts, after the formula's last term (not an operator: \"mode(𝑎) = NA\" is an operand), in an upright text face, is set apart by its face: a thin blank will do; so is a bracketed name in capitals faked as small capitals from two sizes of a text face's capitals (\"(TYINT)\"), and a hyphenated name heading a judgment whose turnstile, from a symbol font, follows a fifth of an em after it (\"Base-Ref ⊢ {𝜈 : 𝜏 | 𝜙} <: 𝜏\"; words joined by an underscore name a predicate: \"has_state(𝜎) ⊢ …\").",
  why: "Every label in the corpus is set apart from its rule by a line break, a gap or a size; none runs into prose. Local Refinement Typing sets its proofs as tables of steps each justified \"By IH\" or \"By 18\"; Refinement Reflection's PLE algorithm opens clauses with \"where\". Nested Refinements ends its bar-less reductions with [E-App] in 7pt small capitals a thin space after the 9pt formula, a Legion paper (E-Null) at 10pt after its 9pt judgment; a small-capital citation in prose (\"From [T-UpRgn]\") follows a line's length of text. \"Cut\", \"(value)\", \"k-var\", \"E Beta\" and \"Definition\" all pass here and are told apart by their setting; Sequent Core's →R and ∀R open with their connective. A grammar-comparison paper sets \"BRANCHEXT.\" over its premises, a relational-verification paper \"HOARE-BIND (INADMISSIBLE IN PRESENCE OF CONTINUATIONS)\" over its rule. A DOT paper runs (∧1-<:) into its axiom and (D-∀) into its conclusion as a superscript, sets (Distr-∧-∨-<:) after a long formula and parts \"(T-∀-E𝑝\" from its bracket; a relational modal logic sets 𝓛-WEAKEN, ↑-EXPAND and ∝-INTRO, math.h's rules run R1 to R15 and R1′ to R13′; a prophecy paper names sequence-prophecy-simple-resolution-typed. CaReSL sets RET and SFORK in small capitals a thin space after their triples; MoSeL sets ∗-mono, −∗-intro and tac-⟨obj⟩-intro over their premises, an API-protocol paper (𝐴𝑃𝐼) beside its bar over (𝑆𝑒𝑞), while an Agda listing aligns \"∗-swap\" with \"∗-assocᵣ\" by their colons; a paramorphism synthesis paper ends \"Γ, 𝑣 : 𝜏 ⊢ 𝑣 : 𝜏\" with (Tvar). Terra's exotypes paper ends \"P Γ ⊢ cInt : Int\" with (TYINT), its Y and NT smaller capitals two points after the formula; a visualization synthesizer sets BASE-REF and TABLE-WIDTH as mathpar labels of premise-less rules, a thin space before their turnstile.",
});
export const RULE_BAR = rule({
  id: "rule.bar", stage: "rule",
  summary: "A rule's bar is a horizontal stroke (a path, a thin image, or a line of four or more dashes set as text, with digits on it or a star at its end, or a long arrow of dashes set as text with a label heading it on its line, its relation's script after the head: \"Red-Do −−−→h\", two such to a line split at their labels) at least two label sizes wide (one and a third, level with the label or under it; one under the label where it is exactly as wide as the line under it) with a line under it within its span, not an edge of a box drawn round a form, not an arrow's shaft, not a word's underline, not a stroke inside a paragraph's line, not a stroke striking text through, not an overline with its index at its end, not a figure's or table's caption's rule; a stroke set close under a line is a bar where a conclusion as wide stands under it; one wider than 92% of the text column needs its conclusion centred under it and shorter, premises and a conclusion fitting it, or the label level with it and beside it; a label level with its end and just past it names a stroke a bar however wide (a slide's derivation runs wider than the formulas that measure its column); one as wide as the column with a short conclusion centred under it is a bar where drawn end to end to its premises or conclusion, and one wider than any line of a page a figure fills is a bar where drawn end to end to its premises over a narrower conclusion centred under it. A bar a wider one runs under from its left edge ends a premise's own derivation, and the label over them names the wider.",
  why: "Dependent JavaScript paints its bars as thin images; Iris papers set a bar as a line of dashes in the text; Kind Inference boxes each judgement form and its bottom edge lies right over the labels under it; a rule spanning the page in Kind Inference and Featherweight Go keeps its conclusion centred, while a figure's own rule has its content set from the left. Kind Inference repeats premises over i under an overline; a dependent type theory sets Ctx-Empty's bar just as wide as its conclusion \"⊢ ·\"; Evidently strikes (tapp) through; a staging paper's CD-ST-DEF sets its bar close under wide premises; asynchronous couplings sets REL-COUPLE-TAPE-L's bar across the column, drawn to its premises, over a short conclusion; Iron's Fig. 4 fills its page and sets tinv-open's bar wider than any formula on it, drawn to its premises. Affect sets its head reductions' long →h arrows as text between redex and result, Red-Do on the arrow's line left of it, Red-Eff and Red-Cont two to a line.",
});
export const RULE_SETTING = rule({
  id: "rule.setting", stage: "rule",
  summary: "A token's setting to its bar and to the lines sharing its row is its category: beside the bar (the bar through its middle, the token outside its span, up to eight sizes off to the bar's right with blank between, or to its left, a line of its own with nothing on its row to its left but another label and no bar ending hard by it there, as far or anywhere in the column where it stands within four sizes of the column's left edge, the stroke not overlining a line that runs on past it and no upright stroke but a box's side between; or under the conclusion, its edge at the bar's, or reaching the conclusion's end from within the bar's span; or ending a line of a conclusion set over several lines past the bar's end, each line hard under the last from the bar down within its span, no other stroke between: another bar or a frame; or two sizes or more past the end of its row, level with a premise, the stack of premises running unbroken from its row down to a bar that starts left of it, at most eight sizes short of it or running on under it only as far as a line of the rule does from its left end, no other stroke between, no line hard under the label reaching under it, no other label set alike heading a line of the stack, no figures on its row), over it (on its own line over the premises, aligned with the bar's left edge or middle, the premises within the bar's span, no other bar between but a premise's own or an overline, the bar as far down as seven leadings (fourteen where the premises run unbroken from the label to it), no label of its own beside it, no relation on the label's row clear of the bar that is not over a bar of its own; the premises one stack, no label set as this one between; a hyphenated, spaced or bracketed name over one line holding a relation between terms (⇔, ⪯ and ≼ too; an incorrectness triple's square brackets; a relation drawn as a picture in the blank between two terms; the TeX symbol fonts' ⊢, ⊑ and msam's ⇛ read from the letters their slots reach the text layer as; the line read as set, runs row by row, where the layout parted a big brace from it), big operators hanging from their baseline, a row running on past a stack of lines level with it between big brackets on its baseline, or a specification whose precondition in braces stands alone on the line under the label and whose stack of lines closes the triple, stands over an axiom set without a bar, and stays so though a rule's conclusion over it is further off; under a hyphenated, spaced or camelCase name a predicate applied to terms or a modality to a proposition in braces, under a hyphenated or spaced one a lone membership, will do), at the end of a row with no bar (the rest of the row three characters or more and a relation level with the token: an arrow, a turnstile, an equation; a table's row of numbers and a paragraph's words are no rule; neither another label, a line hard under another label, nor a brace stretched over a stack of lines is on its row), or at the text column's right margin; a displayed program is no row (a program's keywords, let … in, if … then, while/do, fork, or a statement's closing semicolon, with no relation but its bindings', tests' and assignments', or none but equals signs where the keywords are in a listing's face; over its row, the block of lines stacked under the label is weighed so), nor is a declaration (a colon set apart after the name: an Agda signature); a program with a precondition in braces over it or a postcondition under it is a triple's command, its spec named (a row opening with a quantifier states a lemma there, unless a strong label on its page is set as it is). A heading's judgment form framed alone level with it is no row. A page's two columns are the layout's, with no line of running text across the middle; a caption across it makes the page one column unless a rule drawn down its middle parts the figure in two. Level with a bar on either side, the token stands on the side most of its page's other labels do, or short of a majority there, the paper's. Over a bar, a fraction's numerator rising into the label's row (over its stroke and a denominator) blocks nothing; two sizes or more from its bar beside it, a stroke under the label spanning it is another rule's bar unless it runs under that bar too (the figure's closing rule). A word in capitals closed by a colon alone at the column's left edge heads the rule under it as a bracketed one does; so do labels set in a column of their own (two more at its left edge and size, each bracketed or closed by a colon) however far in from the text's edge the column stands, a premise rising into the label's row over a bar under it, another label on the row, or what stands left of the column leaving it alone; such a label's bar is never one past another label standing over it, across a two-column page's gutter or past a stroke down the page. A label between the bar ending its left neighbour's rule and a bar to its right may head the bar to its right (the page's side then picks), unless a label of its own stands past that bar's end; a bar beside a label across a two-column gutter is the other column's. Over a bar, three plain words under it are a table's subheadings only where no Greek letter makes them a formula; over a bar-less axiom, a stroke hard over part of a line under the label is that term's overline, no bar. Under a rule's label found over a bar, a token over the same bar within three leadings of the label, the bar within three and a half, is a premise. A token opening or ending a line of running text (the rest in the text's face, a paragraph's line over or under it justified to the same edges) is cited there; one heading a condition (\"if …\ Two axioms to a row: a bracketed label ending its row past this one, in this one's face, parts the row as a label heading a part does, and a formula past a label ending its own line is the next rule's. An upright stroke down a figure crossing the label's row, hard past the label or before it with the label at the column's edge, labels set alike beyond it, parts the row in two halves where the label's half holds its formula. Over a bar-less axiom, a line ending short of the label, far left of it on a baseline of its own, is a figure's other part; an overline over a term well short of the row is no bar; a resource's validity asserted or denied (\"✓\\ (ex(𝑎) · 𝑏)\") is a statement under any name; a subscript run into the next term (\"→p𝑒\") reads as a blank; a sentence (four plain lowercase words) under a specification ends it. A caption across the middle leaves the page two columns where nothing else crosses it. A hyphenated name flush with the right end of a bar reaching well left of it, nothing hard over it and no other label between, heads the rule under it; another rule's conclusion on the label's row, under a bar that is no step of a derivation, does not keep it from heading its own; a bar across the text with a conclusion in pieces making up the row under it is a rule's. A premise hard over a bar another label stands beside is on no row of another label's. In a table of axioms two to a row a hyphenated name ending a row part (or a formula ending in one) parts the row, a label set under its formula's end takes that formula, and one predicate applied to its term is a row. A bracketed label alone on its line under a bar-less formula's end (the formula one line, hard over it, reaching from well left of the label to within a size of its right end, no sentence, no definition, nothing but prose, a label or a grammar's production hard over it, nothing on the label's row but what stands two sizes off), ends that formula as its row and the rule's last line. A label heading its line heads what follows it: a line on its row ending left of it is another rule's. A bracketed hyphenated name ending its formula's row with a table's rule just past it ends an axiom in a ruled table of axioms: neither that rule nor the rules over and under the row make it a cell, and its rule is that row alone, up to the rule. A star level with a bar's right end marks the bar, no row's term; a premise centred over a bar under a hyphenated name alone over the bar's left end is that rule's; over a bar-less axiom, a piece of the row hard under a bar clear of the label is that rule's conclusion. A word set smaller than a conclusion, hard under it and inside its span, is the conclusion's script (an arrow's index), no label under it. A name closed by a colon, or ending a line, at a paragraph's left edge under its running text breaking off mid-sentence (a lowercase word ending it) ends that sentence: no label. A token opening or ending a line of running text (the rest in the text's face, a paragraph's line over or under it justified to the same edges) is cited there; one heading a condition (\"if …\", \"otherwise\") is a case of a definition split by cases. Neither is set as a label.",
  why: "Sequent Core sets Cut beside its bar, TypeWhich sets Id's rule, then Const, then its rule on one row (Const is left of its bar, as Id is), Kind Inference k-var over (mathpar) and a-dt-decl over a stack of premises, the Awkward Squad (BIND) at a law's end, Polymorphic Contracts E Op in a column at the margin; \"1 INTRODUCTION\" has nothing on its row but a number. The JFP version of Polymorphic Contracts sets T_Var an inch right of its bar and SWF_Refine under its conclusion, short of the bar's end; a staging paper's ENV-R-EMPTY stands level with ENV-R-KVAR's premises; Melocoton sets ExecCallback at the end of its call's line, between the precondition and postcondition under the bar, while a physical-paths appendix sets (P-Seq) level with its own bar under P-Arm's conclusion, and level-based inference frames (Matching)'s judgment form under LT-LAMC. Litmus tests (MP-lib, P1, OW-NA, bad-concurrency) and Agda signatures (weaken-val : ∀ …) are named at a row's end or head but are programs. A persistency paper ends a paragraph's line with \"(nvo-fofl-d)\" citing an axiom; a floating-point paper splits T(x / y) by cases \"Divide-by-Zero  if x ≠ 0 ∧ y = 0\". A consolidation calculus sets (Skip 1) to (If 2) in a column left of their rules, a synthesis paper RACE-1 and FLD-2 boxed left of theirs (FLD-2 right of FLD-1's bar too), CHL (Lift) to (Loop) over the rule closing its figure; Approxis's wp-couple-rand-rand-err-le stands over a premise whose fraction rises to its row; SDNRacer sets DATAPLANE: over its rule, HOST: level with its first premise's top and TIME1: under BARRIERPOST: level with CONTROLLER:, and CHL sets (Transform − single) and (Fusion 1) in a column far left of their rules; a synthesis paper sets Sig between Frag-Stmt's bar and its own, while Env stands between its bar and Const's with Const after it; Terra sets (LTDEFN) under its conclusion level with the rule closing the next column's figure, and RSL ends a row with (ACQ-SPLIT) level with RMW-ACQ-SPLIT's bar across the gutter; hypersafety's wp-if𝐼 parts \"wp […] λ𝒃. wp\" from \"𝑄 ⊣⊢ wp […]\" by its two stacked cases in big brackets; mechanized relational verification sets fst-clwp over \"clwp π1(v, w) Φ\" and inv-open-clwp over \"clwp e {x. Q}\", every letter upright, and verified interpreters overline 𝑑̄ in \"{nonrec 𝑑̄}\" under let-attr-attr. Aiken's dynamic hierarchical data partitioning sets T-Read, E-Read and twenty more flush right in two columns of a page-wide figure, each level with a premise and clear of its bar; a synchronization-protocols paper frames FLD-2 right of FLD-1's bar. Iris papers draw ⇛ as strokes (GhostCell's MonoInit \"True ⇛ ∃𝛾. MonoVal(𝛾, 𝑛)\"), older ones set ⊢ from cmsy, where it reaches the text layer as \"`\" (a Legion paper's T-Bool, Spirea's LB-PERSISTENT-FLUSH-STORE); a weak isolation paper parts the brace of RC-INIT-CLIENT-SPEC's postcondition from its line; rwp-alloc's \"∀ℓ. ℓ ↦ 𝑣 ∗ 𝛷(ℓ) ⊢ rwp ref 𝑣 {𝛷}\" stands among rwp-load and rwp-store, while MoSeL's (EXAMPLE-MONPRED-UNFOLD) labels a lemma alone; Refinement Types for Haskell sets \"Well-Formedness\" beside its boxed \"Γ ⊢U τ\". MoSeL sets its resource algebra axioms two to a row, (ra-assoc) left of (ra-valid-op)'s row; a C11 paper sets its axioms in two halves of a figure parted by a rule down its middle, (ConsSC) level with its two-line axiom; Sol-Empty stands over \"𝜎 ⊢ ∅\" beside a grammar; RustHornBelt's ENDLFT overlines its frozen objects; a monoid figure's Exclusive and Full-Exclusive deny validity; Blaze's beta reduces with \"→p\". SDNRacer sets twelve rules in two columns over a page-wide caption; Aiken sets [E-Partition] flush right over its premises; MoSeL sets (ora-valid-mono) under its formula; a sequentialization paper sets R-LOOP-REPEAT over a bar across the text, its conclusion in big brackets; a typed-TypeScript paper sets Q-CAST over its axiom level with R-CAST's premise. Terra's exotypes paper sets (TAPP), (TUNWRAP), (LAPP) and (LRUNPROP) on lines of their own under their reductions' right ends, a relational verification paper (CallIncr-incorrect-spec) under its specification, while a persistency paper's \"… is PTSO-valid iff:\" leads into \"• tso is total on E \\ R;  (tso-total)\" and a visualization synthesizer sets Base-Trans's conclusion left of \"Base-Ref ⊢ …\". Px86 sets its axioms in a ruled table, \"(tso-po)\" ending \"([𝑊 ∪ 𝑈 ∪ 𝑅]; po; …) ⊆ tso\" left of a column checking it (\"A1–C4\"); Mixtris ends Wp-load's bar with a star on Wp-alloc's row and runs Wp-alloc's axiom into Wp-load's conclusion; a liveness paper indexes \"NOM\" under its conclusion's arrow; the power of parameterization ends \"… can be derived from\" with \"APPV:\" over SEQ's premises, a hypersafety paper ends \"can prove: (i) … ⇒ (Idem³ₜ)\" under \"For example, we\".",
});
export const RULE_SHAPE_HYPHEN = rule({
  id: "rule.shape.hyphen", stage: "rule",
  summary: "A hyphenated name: a prefix of a capital and up to nineteen letters and up to two digits (up to eight when all lowercase, unless its letters are set in small capitals, short lowercase modes joined by bars (c|q), camelCase, a lowercase word and one or two capitalised ones after it with up to two digits, one or two Greek letters, one or two connectives or modalities with a digit maybe, an arrow, a proportionality, a flat, a separating conjunction's star or a magic wand, or a modality's word in angle brackets), then one or more parts in any case, or of connectives, modalities, an empty record's braces or a modality's word in angle brackets, joined by a hyphen (a minus sign too, as Hyper Hoare Logic's text layer reads While−∀∗∃∗), a colon, a slash or an underscore, a part may end in a sign (a trailing hyphen too, a star, an arrow, a two-way arrow) or join capitalised pieces with a plus, a hyphen and an arrow or a star alone may end the name, and the name in a short parenthesised tag, a spaced number or a spaced capital or two in square brackets (\"T-App\", \"LT-APP\", \"k-var\", \"cmpList-Nil\", \"S-refl\", \"DEC-<:-BASE\", \"WF-var+\", \"WF-var-\", \"β-reduction\", \"T:Proc\", \"≤-Base\", \"Sem-⊤\", \"cbncoeff-app\", \"extS-addSk\", \"□-Mono\", \"iris-□-intro\", \"⟨affine⟩-intro\", \"<:-⊤\", \"∧1-<:\", \"T-{}-I\", \"NTerm-↑\", \"effect-l-★\", \"M-PropW+NTW\", \"Ht-listen [S]\", \"Wrap1-Fld\", \"iRC11-CInv-New\", \"↑-EXPAND\", \"♭-intro 1\", \"∗-mono\", \"−∗-intro\", \"tac-⟨obj⟩-intro\", \"NTerm-↕\"); a word numbered after its hyphen is a name in capitals or small capitals (err-1), a formula after a lone letter. A tag in parentheses run into the name opens with a capital or a digit: a lowercase argument there makes it a predicate or a procedure applied to a term (\"is_mask(𝑡)\", \"phys_atomic(𝑒)\", \"Synthesize-Classical(f)\"). Curry-Howard is one by shape and told apart by its setting.",
  why: "acmart's small capitals reach the text layer in lowercase, so the parts may be in any case; \"call-by-name\" and \"well-typed\" are names by shape and told apart by their setting. Generic Refinement Types ends names in a sign, Hyper Hoare Logic in a quantifier, Ownership Types in a colon; PACMPL papers since 2024 prefix names with a judgment's whole word (MAInconsistentTypes-C, bigbmix-frame) or a connective (≤-Base) and end parts in one (Sem-⊤, bdg-∂). Modal logics name rules after their modality (MoSeL's □-mono, ⊡-intro and ⟨affine⟩-intro, Iris-□-Intro); a DOT paper names subtyping rules after the types related (<:-⊤, ∧1-<:, 𝜇-<:-𝜇, T-{}-I); Blaze marks its relational rules with a star (Effect-L-★), a transpiler its trace rules with an arrow (NTerm-↑), an x86 model joins the writes propagated (M-PropW+NTW), a distributed separation logic tags specification rules (Ht-listen [S]). Error credits set presample-exp and statestep-simple in small capitals, ReLoC inadmissible-bind; a smart-contract synthesizer numbers Wrap1-Fld, RustBelt Relaxed prefixes iRC11-CInv-New; a relational modal logic names ↑-EXPAND and ∝-INTRO after the relation, Cartesian Hoare Logic ♭-intro 1 and ♭-intro 2. MoSeL names its BI axioms after the connective (∗-mono, −∗-intro) and a tactic after the modality it introduces (tac-⟨obj⟩-intro); a transpiler marks its bidirectional checking rules with a two-way arrow (NTerm-↕). A bitfield paper sets the side condition is_mask(𝑡₂) beside Ty-mask's premises and defines is_mask(𝑡) by rules, a prophecy paper sets phys_atomic(𝑒) beside inv's premise, a quantum uncomputation paper heads procedures Synthesize-Classical(f) and Make-Adjoint(𝑆).",
  pattern: new RegExp("^" + RULE_NAME + "$", "u"),
  matches: ["T-App", "LT-APP", "E-Beta", "WT-Fun", "DEC-<:-BASE", "S-Trans", "R-IfTrue", "Ty-Lam", "E-β", "T-App-Abs", "S-refl", "k-var", "pgm-dt", "t-named", "C-trans", "a-kapp-kuvar", "WF-var+", "Rel-Fun±", "β-reduction", "T:Proc", "Step/Seq", "Program_E", "While-∀*∃*", "DS-∀", "PiggyBank-Persist", "coeff-var", "tcwf-app", "Curry-Howard", "call-by-name", "thoare-inv", "η-Red", "WF-var-", "MAInconsistentTypes-C", "bigbmix-frame", "cbncoeff-app", "extS-addSk", "cmpList-Cons", "T-Letmod’", "E-Op♠†", "Sem-⊤", "≤-Base", "Prf-⊃-Intro", "bdg-∂", "c|q-Splice", "c|q-Sub-Expr", "⪯-Base", "While−∀∗∃∗", "naïve-⊕PL", "□-Mono", "⊡-intro", "iris-□-intro", "▷□-SWAP", "⟨affine⟩-intro", "<:-⊤", "∧1-<:", "∀-<:-∀", "T-{}-I", "NTerm-↑", "S-NTerm-↑", "effect-l-★", "M-PropW+NTW", "M-PropFL+FO+SF", "Ht-listen [S]", "L-*", "Wrap1-Fld", "iRC11-CInv-New", "↑-EXPAND", "∝-INTRO", "♭-intro", "∗-mono", "−∗-intro", "−∗-elim", "tac-⟨obj⟩-intro", "NTerm-↕", "HigherOrderTerm-↕"],
  rejects: ["T-", "-App", "−↑-EXPAND", "T-↕↕", "jump", "T-App:", "(T-App)", "Choice(L)", "|q-Nat", "COST_02+COST_21", "T-App [12]", "□", "T-↑↑", "is_mask(t)", "phys_atomic(e)", "Synthesize-Classical(f)"],
});
export const RULE_SHAPE_SPACED = rule({
  id: "rule.shape.spaced", stage: "rule",
  summary: "A spaced name: a prefix of one or two capitals or a Greek letter, a space, and a capitalised word (\"E Beta\", \"T FUNC\", \"E PreCheck\", \"β Box\"); or a capitalised word, a space, and one or two capitals, a digit or an arrow (\"Val T\", \"Clos E\", \"Interchange 1\", \"Propagate ↓\"); or capitalised words joined by hyphens, a space and an arrow with an optional digit (\"Insert-Abs ↓\", \"Propagate-Var ↓1\").",
  why: "LNCS and JFP papers set \\rulename{E}{Beta} with a rule between the parts that reaches the text layer as a space; a call-by-push-value paper names its rules Val T and Eval T after the judgement.",
  pattern: /^(?:(?:[A-Z]{1,2}|\p{Script=Greek}) [A-Z][\p{L}\d]{1,15}|[A-Z]\p{L}{1,11} (?:[A-Z]{1,2}|\d{1,2}|[↓↑])|[A-Z]\p{L}{1,11}(?:-[A-Z]\p{L}{1,11})+ [↓↑]\d?)$/u,
  matches: ["E Beta", "T FUNC", "E PreCheck", "WF Empty", "S SUB", "Val T", "Clos E", "Interchange 1", "Propagate ↓", "β Box", "Insert-Abs ↓", "Propagate-Var ↓1", "Fallthrough-Error ↑"],
  rejects: ["e beta", "ABC Def", "E beta", "E B", "A note", "the T", "Insert-Abs 1"],
});
export const RULE_SHAPE_WORD = rule({
  id: "rule.shape.word", stage: "rule",
  summary: "A single word of two to twenty-four letters and digits, primed or not, starred (★ or *) or numbered after a hash (\"CALLBACKREG#1\"), a word of letters with a plus after it (\"refl+\"), with or without a short parenthesised tag, spaced or not, or an abbreviation (a period after it) with a case of up to eight letters in parentheses (\"Cut\", \"BIND\", \"step\", \"InstLSolve\", \"MKSRelocationConflict\", \"MKSIf’\", \"A1\", \"Choice(L)\", \"LChoice (L)\", \"SeqCompDiv (1)\", \"cong. (variadic)\"). A tag run into the word opens with a capital or a digit: a lowercase argument there makes it a predicate applied to a term (\"atomic(𝑒)\", \"proj(𝑡)\", \"CurTh(𝑗)\").",
  why: "Slotted E-Graphs sets cong. (variadic), cong. (bind) and cong. (f) beside their bars and cites cong. (bind); an Android race detector numbers variants CALLBACKREG#1 and CALLBACKREG#2, a C11 logic strengthens CAS to CAS*, a stuttering simulation paper strengthens SEQ to seq+ (a sum after an index is a formula, 𝜀1 + Σ …); Sequent Core, the Awkward Squad and Consistent Subtyping name rules with one word; where it stands decides whether it labels a rule. RustBelt Relaxed sets the side condition atomic(𝑒) at the end of SC-CInv-Acc's premise, hard over its bar, hypersafety proj(𝑡) beside wp-proj's bar, mechanized relational verification CurTh(𝑗) heading its thread rules' premises, where Choice(L) and SeqCompDiv(1) are tags.",
  pattern: /^(?:\p{L}[\p{L}\d\p{Co}]{1,23}(?:#\d{1,2})?['′’★*]?|\p{L}{2,23}\+)(?: \([\p{L}\d]{1,4}\)|\((?!\p{Ll})[\p{L}\d]{1,4}\)|\. \(\p{L}{1,8}\))?$/u,
  matches: ["Cut", "BIND", "step", "InstLSolve", "A1", "jump", "Choice(L)", "FixedPoint(Err)", "LChoice (L)", "SeqCompDiv (1)", "MKSRelocationConflict", "MKSIf’", "cong. (bind)", "cong. (variadic)", "CALLBACKREG#1", "refl+", "seq+", "CAS*", "All(Id)"],
  rejects: ["a", "1", "T-App", "E Beta", "Cut:", "verylongwordthatisnotaname", "cong.", "cong.(bind)", "ε1+", "C++", "A#", "atomic(e)", "proj(t)", "CurTh(j)"],
});
export const RULE_SHAPE_SYMBOL = rule({
  id: "rule.shape.symbol", stage: "rule",
  summary: "A symbol name: one or two connectives, or a digit or a truth constant, with one to three side letters and a digit (\"→L\", \"∀R\", \"⊗L\", \"×T\", \"+I0\", \"1I\", \"⊕PR\", \"⊤T\"), a connective with a digit or ∞ (\"⋍0\", \"=0\", \"=inf\") or a word of two to twelve letters or a Greek letter, with a side after a slash (\"∼Empty\", \"<:eq\", \"<:reft/l\", \"≡inst\", \"≡κ/l\"), one or two capitals and a connective (\"L→\"), or up to three with a separating conjunction's star among them and a capital after (\"R∗⊤\", \"R∗∗\", \"L∗\", \"R∃∗𝐴\"), or a capitalised word, a connective and one to three lowercase letters (\"St+i\", \"St+uu\"), or a modality and one or two capitals (\"□I\"), as sequent calculi and logical relations name their rules.",
  why: "Sequent Calculus as a Compiler IR names →L and ∀R beside their bars and cites them so; a call-by-push-value paper names ×T, +T, 1I and &T after the connective; a bidirectional typing paper names ∼Empty, ⋍0 and ⋍∞; PACMPL subtyping and equivalence papers name <:eq, <:reft/l and ≡inst after the relation; a bidirectional typing paper names its addition's steps St+i and St+uu after the step judgment; a separation-logic prover names its rules after the connective and the separating conjunction (R∗⊤, R∗∨, L∗); a logic for Hoare-style reasoning names □I after the modality it introduces.",
  pattern: new RegExp("^(?:[" + RULE_CONNECTIVES + "]{1,2}(?:[A-Z]{1,3}\\d?|\\d|∞|\\p{L}{2,12}(?:/\\p{L}{1,2})?|\\p{Script=Greek}(?:/\\p{L}{1,2})?)|[\\d⊤⊥][A-Z]{1,3}\\d?|[A-Z]{1,2}[" + RULE_CONNECTIVES + "]{1,2}|[A-Z]{1,2}(?=[^*]*\\*)[" + RULE_CONNECTIVES + "*]{1,3}[A-Z]?|[A-Z][a-z]{1,11}[" + RULE_CONNECTIVES + "]\\p{Ll}{1,3}|[" + RULE_MODALITIES + "][A-Z]{1,2})$", "u"),
  matches: ["→L", "∀R", "⊗L", "L→", "∀L", "×T", "+I0", "&T", "1I", "⊕PR", "⊲V", "⋍0", "⋍∞", "∼Empty", "<:eq", "<:reft/l", "≡inst", "≡κ/l", "~Cons", "=0", "=inf", "⊤T", "▷V", "St+i", "St+uu", "?R", "!L", "R*⊤", "R**", "L*", "R*A", "R∃*A", "R*∨", "□I"],
  rejects: ["→", "L", "→→→L", "→l", "12", "∞", "<:a", "R*AB", "ABC*"],
});
export const RULE_SHAPE_SHORT = rule({
  id: "rule.shape.short", stage: "rule",
  summary: "A short name: one to three signs, digits and Greek letters with a connective, an exponential (! ?) or a Greek letter among them and at most two Latin letters, or a bar and one to three such (\"⊗\", \"!\", \"1⊥\", \"!w\", \":π1\", \"|⊗\", \"|w\", \"=α\", \"β→\", \"μ\", \"β+0\", \"cc→\"), one upright letter or digit alone (\"c\", \"1\"), or a type's letter and a mathematical capital (\"U 𝐼\"); a letter read from a symbol font is a glyph (⋆ here: ⅋ reaches the text layer as stmary's \"O\"). Beside a bar it stands where two more labels stand beside bars on its page, on its side, and, made of signs alone, where the paper names two rules so; elsewhere only in brackets, in a column of labels set alike. A letter in a drawn ring is a marker, a Latin letter or digit in brackets an item's or an equation's tag unless beside a bar of its own on a page of labels named by glyphs (\"(1)\" by \"(𝜔)\" and \"(𝜌)\") or, a capital, beside a bar where a strong label set as it is stands beside one on its page (\"(C)\" under \"(no-C)\"), a connective before a math letter a formula (\"¬𝜑\"). It is cited only with \"rule\" by it, or in brackets with a sign and a letter, set as its label is.",
  why: "Better Late Than Never names the rules of linear logic by their connective (⊗, ⅋, 1, ⊥, !, ?, W, C) and their transitions :π1, |⊗, !?; Sequent Core names its machine steps (β→), (β∀), (μ) and its rules ∀, ∃×; Call-by-Unboxed-Value (β×), (η&), (𝑐𝑐→), U 𝐼. Each is cited as \"rule !\", \"rules c and w\"; a bare \"1\" or \"!\" in prose is a number or a sign, a lone \"?\" beside a bar an open goal, a \"⊥\" at a diagram's edge a type.",
  pattern: new RegExp("^(?=[^A-Za-z]*(?:[A-Za-z][^A-Za-z]*){0,2}$)(?:\\|[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}\\dA-Za-z]{1,3}|(?=.*[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}])(?![:=<~+&*]$)[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}\\dA-Za-z]{1,3}|[A-Za-z\\d])$", "u"),
  matches: ["⊗", "⊥", "1", "!", "?", "⋆", "c", "W", "⊕1", "!?", "!w", ":π1", "|⊗", "|w", "=α", "1⊥", "⊗⋆", "⊕1⋆", ":⋆0", "π", "μ", "β→", "β∀", "∃×", "β+0", "η&", "βλ", "cc→", "|c", ":C"],
  rejects: ["12", "→→→L", "abc", "T-App", "x+y+z", "ab", "|", ":", "abc→", "(1)"],
});
export const RULE_SHAPE_PHRASE = rule({
  id: "rule.shape.phrase", stage: "rule",
  summary: "A phrase of two to four words, the first capitalised, in parentheses at the end of a row, in a column of two or more labels set alike (\"(Sequential composition)\", \"(Left choice)\", \"(Fixed point)\" among \"(One)\" and \"(Some)\"): alone, such a phrase is prose. In brackets making up its line at a bar, a phrase of letters in any case, a colon after its first word, or a hyphenated name spaced round its hyphen, labels its rule where two more bracketed labels stand at bars on its page on its side and at its size, or, alone on its page, where the paper sets two more phrases so on others (\"(MEMORY: NEW)\", \"(call parameter)\", \"(Transform − single)\"); cited or not, one alone titles a judgment (\"(Kind Elaboration)\").",
  why: "Shoggoth labels the rows of its denotational semantics (Sequential composition), (Left choice) and (Fixed point) in the column where it sets (One), (Some) and (All). The promising semantics sets (MEMORY: NEW), (SYSTEM CALL) and (MACHINE STEP) over their bars among (READ-HELPER) and (PROMISE), its successor in lowercase (memory: new); a points-to paper sets (call parameter) by (assign) and (store).",
  pattern: /^\p{Lu}\p{Ll}+(?: \p{L}+\.?){1,3}$/u,
  matches: ["Sequential composition", "Left choice", "Nondeterministic choice", "Fixed point", "Case of known constr."],
  rejects: ["Cut", "left choice", "E Beta", "A b c d e"],
});
// At a bar, in brackets, a phrase may be in any case, a colon after its
// first word (rule.shape.phrase).
export const RULE_PHRASE_AT_BAR = /^\p{L}{2,12}:?(?: \p{L}{1,12}){1,3}$/u;
export const RULE_SHAPE_TITLE = rule({
  id: "rule.shape.title", stage: "rule",
  summary: "A titled name: one to three capitalised words, each maybe hyphened and the last after the first numbered after a hyphen (\"Filter Op-1\"), or four or five with one lowercase preposition among them (\"Read from Value Dependent Container\"), then a parenthesised case of one to three capitalised words, or two to three such words alone, making up the label's whole line (\"Free Ok\", \"Nondeterministic Lifting\", \"One-Sided If\", \"Under-Approx Left\", \"If (Multi-Outcome)\", \"If (Single Outcome)\"). It is weak, as a word is: it stands beside a bar only as the convention allows (rule.convention), over a bar only where two more labels on its page, no titles, stand over their bars as it is set, and never at a row or at the margin: elsewhere such words head a group of rules, a table's rows or a figure's part (\"Well-formed Type\", \"Prior Work\", \"Monadic Rules\").",
  why: "Outcome Logic sets its rules' names in small capitals beside their bars, Free Ok, Store Er, Error Propagation and If (Multi-Outcome) among Error, Alloc and Frame, and cites them \"the Error Propagation rule\"; small capitals reach the text layer as a capital and lowercase letters, so the words read as a title. An FTA-synthesis paper sets Angelic Recursion, Uneval Prod and Switch Left over their bars as it sets Init, Unit and Pair; a visualization synthesizer Filter Op-1 beside Filter-1, a container analysis Read from Value Dependent Container over its rule as it sets Newval and Update.",
  pattern: /^(?=\S+ )(?:\p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?:-\d{1,2})?){0,2}|\p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2})? (?:from|to|of|for|at|in|on|with) \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}){0,2})(?: \(\p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}){0,2}\))?$/u,
  matches: ["Free Ok", "Store Er", "Nondeterministic Lifting", "Error Propagation", "One-Sided If", "Under-Approx Left", "If (Multi-Outcome)", "If (Single Outcome)", "Bounded Unrolling", "Filter Op-1", "Read from Value Dependent Container"],
  rejects: ["Frame", "free ok", "Separation Logic Small Axioms", "If (multi)", "Free ok", "T-App", "Free  Ok"],
});
export const RULE_NAME_BESIDE = rule({
  id: "rule.name.beside", stage: "rule",
  summary: "Beside a bar, a name is hyphenated, spaced, a symbol, a word, or capitalised words (rule.shape.title); a lowercase word stands only in a convention of two or where it is cited.",
  why: "Cut, VAR, InstLSolve, [LT-APP], →L; Frex sets refl, sym, trans, cong and eval beside their bars in small capitals that reach the text layer in lowercase, while a lone lowercase word level with a bar's end is a premise's tail.",
});
export const RULE_NAME_OVER = rule({
  id: "rule.name.over", stage: "rule",
  summary: "Over a bar, a name is hyphenated, spaced, a symbol, or a word; a bare word stands only in a convention of two or where it is cited.",
  why: "k-var, S-refl, t-named, [step]; acmart's mathpar sets Quote, Splice, Refl, prodOrSum and Wp-Val in small capitals over the premises, the most common setting in PACMPL since 2024, while a lone bare word on its own line over a bar is the first premise.",
});
export const RULE_NAME_ROW = rule({
  id: "rule.name.row", stage: "rule",
  summary: "At the end of a row, a name is hyphenated, spaced, or a bracketed word; at the head of a row that reduces (an arrow between its sides), a bare word too, standing as the convention allows (rule.convention). A bare word heading an entailment (⊢, ⊨) stands as one heading a reduction does; a word in capitals throughout ending its formula's own line, set apart there by its face (rule.candidate), names that row.",
  why: "(BIND), (lamr), T FUNC; app, beta and invoke in small capitals heading reductions among unw-inter-zone and unw-intra-zone; a bare word ending a row is the grammar's category (\"program\", \"Syntax\") or a heading (\"INTRODUCTION\"), and one heading a judgment's row names its form (\"Typing\" before Γ ⊢ 𝑒 : 𝜏). Blaze heads \"traversable(…) … ⊢ …\" with bind among standard-bind and unsound-bind; CaReSL ends its triples with RET and SFORK.",
});
export const RULE_NAME_MARGIN = rule({
  id: "rule.name.margin", stage: "rule",
  summary: "At the margin, a name is hyphenated, spaced, a word in square brackets, a parenthesised word after a row that steps or states a law (an equivalence or a wand), or a parenthesised word in lower case, which stands only as the convention allows (set as two strong names are, or cited); a capitalised parenthesised word there heads a group of rules or labels an example, unless it is a camelCase word, or a word indexed by a mathematical letter (Idemₜ), the text cites, or set as one within four rows of it, its row not left open by a connective (a definition's conjunct) and its name no other label's at a bar (a proof's step citing that rule), or a word in capitals throughout (small capitals losing a camelCase name's case) set alike at the margin on its page with one the text cites, or set alike ending its rule as one the text cites does (a bracketed label ending its rule is one convention whether a bar, a row or the margin stands beside it). A camelCase parenthesised word ending an axiom stands as findRules weighs it (cited or among cited ones), but not by a definition (≜, ≝) or a program (an assignment, a statement ending in its semicolon); a bare word in capitals throughout after a row that steps or states a law stands as a bracketed one does; a lowercase parenthesised word the text calls a rule (\"rule\" hard by it, or \"the premise of\" before it) names one; a capitalised word or a phrase in parentheses after a row with a relation (a word's row neither stepping nor stating a law; not a numeral, roman or a letter's with digits; no definition by ≜, := or ≝ on the row; a program's let-bindings relating nothing) names its rule where the text cites it in its brackets in running text, or cites one set as it is at the margin on its page, or where two strong names stand set as it is on its page, or in a figure of axioms; else it titles a group.",
  why: "E Op, E Beta in a column at the margin; [Int] and [Var] at the margin of a typing rule set as one line; StackKAT's (filter) between (push-pop) and (pop-push); (Kinding) at the margin over the kinding rules and (C1) beside an example are not cited as rules; Melocoton's (RegRoot) and (UnregRoot) end Hoare triples and are cited as RegRoot and UnregRoot, while Lawyer's (lockedExcl) tags a conjunct ending in ∧ and Hyper Hoare Logic's (HavocS) at a proof's step cites the HavocS rule set at its bar; Terra sets (SBAS), (SVAR), (TVAR) and (TAPP) at the margin and cites \"Rule SVAR\", and sets (LVAL) after an axiom's row as (SESC) beside its bar. GhostCell sets (TokSplit) after an equivalence right over the cited (TokCombine); GPS sets (GetPerms) to (NewGhost) after view shifts, cited or not. A C11 paper sets (IrrHB) and (CohWW) by their axioms and cites them; (LiftRec) by a definition and (LBfd) by a litmus program are no rules; CaReSL's SPLITISL ends \"s₁; T₁ ∗ s₂; T₂ ⇔ …\"; Iron sets (affine) after \"P ∗ Q ⊢ P\" and calls it \"the weakening rule affine\". A monadic-encapsulation paper sets (Neutrality), (Commutativity) and (Rec hoisting) after contextual refinements and cites \"Refinement (Neutrality) expresses …\", and (Left Identity) in the next figure uncited; the promising semantics sets (Atomicity) between (RR-coherence) and (No-promises); a hypersafety paper sets (Idem𝑡) after a hyper-triple and cites \"the hyper-triple (Idem𝑡)\"; a kind inference paper's (Kinding) and an actor paper's (Actors) beside a grammar's \"A = x : Σ\" are titles, a C11 paper's (P2) a program's tag, a weak-memory paper's (Conflict relation) a definition's, \"let r = ref(0) in …  (Awkward)\" a program's. Stuttering for free sets (tarski) after Tarski's principle and cites \"the premise of tarski\". A hypersafety paper sets (Idemₜ) and (Idem³ₜ) at the margin after their hyper-triples, citing both.",
});
export const RULE_NAME_LETTERS = rule({
  id: "rule.name.letters", stage: "rule",
  summary: "A hyphenated name has a letter or a connective past its hyphen (a capitalised word, or a word in capitals or small capitals, may be numbered: Continuous-1, err-1), and a label's line is no larger than 1.2 times the body size. A name set wholly as a script of its line (raised or lowered) is none, nor is one on a line set smaller than a line it hangs from (a quarter or more larger): hard under or over it within its span (a limit), or level with it from within it or glued to its end, its baseline within that line's height, or lowered and glued to a lone letter at full size (an index the layout split off).",
  why: "sql-01 in a benchmark table is a name of digits; \"4.5 Kinding\" is a section heading; \"NOM\" under the arrow of a conclusion, \"local_data\" of c_local_data and \"non-terminating\" of p_non-terminating name no rule.",
});
export const RULE_CONVENTION = rule({
  id: "rule.convention", stage: "rule",
  summary: "Labels sharing a category, side, bracket style, faces (of the name itself) and size are a paper's convention. A single-word label (or a spaced name ending in a digit or an arrow) stands only where the text cites it in the form its setting allows, or in a convention of two or more of which the text cites one, or in a convention two hyphenated, spaced or symbol names share; those stand alone. A bracketed label ending its rule counts with those set so beside a bar, a row or the margin alike. In a paper of rules — eight or more hyphenated, spaced or symbol names at bars — a bare word at a bar in the face and size two of those names share stands; so does a camelCase word at a bar in a convention of five. A single word over a bar-less axiom stands where two of its convention stand over bars, or one does and three are set so without a bar on its page. A quantified row's label stands beside a strong or camelCase label (no definition's conjunct) set as it is on its page, a label ending its row mid-column being set as one at the margin. A bracketed word ending a bar-less axiom's row joins labels set beside bars on its page in its face and brackets. A column of three bracketed labels or more set alike at the margin under a bold heading a few leadings over it that calls them axioms, rules or laws is a figure of axioms: each stands however its row opens and however the text cites it. So is such a column of hyphenated names inside a figure (a higher-order ghost state paper's RA-ASSOC to RA-VALID-OP in Fig. 3). A quantified row's label naming a specification (\"…spec\", braces on its row) stands as one. A word in capitals at the margin stands set as a cited one is anywhere in the paper at the margin. A name calling itself a law, a rule or an axiom by its number (\"Law 3\"), two or more alike on its page, stands at a row or the margin.",
  why: "Sequent Core sets Cut, Case and Jump the same way beside their bars and cites Cut; Definition in a table's header stands alone and is never cited; a benchmark table's headers, a plot's legend and a diagram's labels are set alike by the dozen, and none is ever cited as a rule. Iris and separation logic papers set Löb, Work and LET among dozens of hyphenated names and never cite them by name; Hazelnut sets its camelCase names by the dozen and cites none. A capability machine paper sets RepeatStandby, RepeatHalt and RepeatFail bar-less beside RepeatSingle's rule. MoSeL's (ra-assoc) and (ora-⊑-refl) open with ∀ beside (ra-unit-valid) and (ora-comm); a paramorphism synthesis paper sets (Tvar) after its axiom among (Tabs), (Tapp), (Tctr) beside bars. GPS sets (ConsistentMO1) to (ConsistentAlloc), each after a quantified axiom, under \"A.3.5 Axioms\" and cites none; Lawyer opens runAsync-spec's triple with \"∀𝑓, 𝑃, Φ.\"; a coinduction paper sets (COEN) as it sets the cited (TARSKI) ten pages before; a weak isolation paper ends six entailments with (Law 1) to (Law 6).",
});
export const RULE_HEADING = rule({
  id: "rule.heading", stage: "rule",
  summary: "A token level with a grammar production (::=, := with a | or ∣ alternative outside brackets, a | alternative under one, or a column of two or more signs — ::=, :=, def=, ≜, or BNF's → — stacked a leading or so apart after a category's name, with alternatives among their right sides or each repeating one category; a | in a machine's brackets or a set's braces after := is none) comments the production, heading or ending it, or heading a line of categories over one; a token over a bar whose row or conclusion is a production is the grammar's term, no label; a bare name a blank before a colon or a sign of definition (≐, ≜, ≔, :=) opening its row is the name declared there (a signature's, an API table's), a colon hard after a name closing it as a label's; a token over an arrow in the line hard under it (only its shaft and head under the token) annotates the arrow; a bare token set in a listing's monospace face is code (a bracketed one names a lemma), unless the paper sets five or more labels at bars in that face; a bracketed word at the margin with only a form level with it heads a group of rules or labels an example, as does a bare word over a bar with a hyphenated, spaced or symbol name between it and the bar, or beside it, or with one set as three times as many of the paper's labels are. A label in a listing is code: on a numbered line (a numeral opening it or set on its row to its left, the next or last number a line away in one column; a number in the page's margin numbers a manuscript's lines for review), heading such a line, or inside an algorithm's float (between the rule over its \"Algorithm n\" caption and the rule closing it). None names a rule. A hyphenated, spaced or symbol name set smaller than a label, between it and the bar under it, labels that bar; the label over it heads the group (\"Implements\" over <:-Param).",
  why: "\"(value)\" beside \"e ::= v\", \"(Kinding)\" at the margin right of \"Σ ⊢ τ : κ\" and \"(C1)\" beside an example are not cited as rules; \"(BIND)\" stands at the right of a law set in from the margin; \"(Reduction)\" stands in italics over R-Proj2Beta's rule, \"All\" underlined over allEmpty; omit_all_labels(t) is a listing's line over an example; Synthesize-Classical(f) heads numbered pseudocode, part_list stands on Listing 5's line 171, \"Program P\" in Algorithm 2's inputs; \"Program P\" beside \":= e+\" over \":= v | c | nil\", \"Prog 𝑃\" beside \"→ 𝑆 | 𝑃; 𝑆\" and \"Type T :=\" among a column of \":=\" name a grammar's categories, \"Typing\" over FT-PRIM's bar heads the figure; \"mfix  :  ∀A P. …\" declares a constructor, \"TId:Lab\" indexes a transition's arrow; let-attr-attr's reduction ends in the set \"{𝑥 := 𝑘 𝑑 | 𝑥 := 𝑑 ∈ 𝑑}\", no grammar.",
});
export const RULE_DERIVATION = rule({
  id: "rule.derivation", stage: "rule",
  summary: "A bar with a narrower bar just over it (under the label, for a label over its bar) within its span, and a line between within the upper bar's span, or one whose conclusion leads into a wider bar under it that no label of its own names and that has a conclusion of its own under it (not running text, a caption or the next row's labels: a table's or a figure's rule), is a step (the line between holding a letter or digit, not a row of vector arrows) of a derivation tree; so is a bar whose tree does not nest (a step to one side of the bar it leads into, or wider than it) where the two share half the narrower's span and the line between, a judgment over the lower bar and mostly under the upper, stands alone there; the line between may be a judgment set tall, its braces and stacked parts reaching the layout as lines each overlapping the last from hard under the upper bar to hard over the lower (within four leadings); a step's conclusion may hang past the end of the bar it leads into, mostly over it, beside another premise of that bar; a judgment's relation may be drawn in strokes (a turnstile's pieces), running text in parentheses within the upper bar's span is a premise in words, a big bracket's top piece is no text an overline hugs, and premises set side by side in one line are no subterm a bar overlines; a tree set as an equation's right side (a name and \"=\" hard left of its bar) or marked by a letter in a ring (before its bar's start, or two rings or more standing alone as its premises) is a derivation too; a bar leading into a step, and a label at a step's bar, are steps too; a stroke in a heading's rule, a table's rule, a figure's closing rule over its caption, a frame's edge, a subterm's or subscript's overline and a boxed step inside a rule's conclusion are no steps; a label at a step cites its rule and never defines it. A lower bar whose premise row holds lines clear of the upper bar running well past both its ends (other rules' conclusions packed hard over it) is a rule's own, no step.",
  why: "Mechanizing Refinement Types and Frame Inference for Rust set example derivations with each step labelled by its rule; a link to the name should open the rule, not the example. Proving Hypersafety Compositionally sets a hyper-triple three lines tall between WP-CONJ₀'s and WP-PROJᵢ's bars; CISL writes \"(derived via Seq, Atom and CISL_RD axioms on p. 14)\" over PAR's premises; Silq names subtrees \"① = …\" and draws its turnstile under α; an elaboration paper marks its example trees Ⓐ, Ⓑ, Ⓒ. CISL's SV-CS stands over the rule closing Fig. 13 over its caption: no step. Px86 sets T-FO's bar on its figure's last row, the figure's rule and caption under it. A persistency paper sets T-While's axiom bar under T-Seq1's conclusion, T-If's and T-Seq2's conclusions on each side of it: no step.",
});
export const RULE_CELL = rule({
  id: "rule.cell", stage: "rule",
  summary: "A token level with a bar and within its span is a cell over a table's rule, as is one between two rules of one span with the upper right over it; one with the bar touching it on both sides heads a group; one with a vertical rule drawn through its row within three sizes, or a wall (an upright stroke, or the edge of a box taller than two lines) between it and its row, is in a table, a box round a judgment's form beside it aside; a row holding words in the text's face and no relation is a table's, and so is one with numerals under it beside the token (a row's heading at most to their left, numerals in the margin clear of the column numbering its lines aside), however its cells are ruled. An upright closed at both ends by strokes across is a judgment's box, not a wall, unless those strokes close three uprights or more: a grid's row (ticks and \"n/a\" in a table of formats). A token over a bar under which stands a table's row (three pieces or more a blank apart, two of them cells of plain words or figures) or three cells of figures within three leadings heads the table's columns; every token inside a float captioned as a table is a cell, unless two or more of its tokens stand at bars of their own wider than five sizes and well short of the table's width (a table of rules); a stroke one of three or more drawn alike from one left edge, evenly spaced, is a plot's gridline and no bar; a token with an arrow's head drawn within a size of it (a small shape where a longer thin stroke ends) is a diagram's node or edge label. The rest of a caption, each line hard under the one before in its face and size, concludes nothing, as its first line does.",
  why: "Program, Line, Char over a table's rule; MLKit over a column of timings, underlined where they improve; \"——— Structural ———\" between groups of rules, while [fvar] has a gap before the next rule's bar; (base) and (offset) in a ruled table's cell; Z3 and CVC4 over their columns' \"lines functions branches\", k-prenex heading an unruled row of Table 1, a plot's title over its top gridline, \"[init]\" in an execution graph; acmart's review line numbers (\"1846\", \"1847\") beside FLD-2's row make no table; a review copy of type-directed visualization synthesis numbers its lines in the margin beside Base-Trans.",
});
export const RULE_DEFINITION = rule({
  id: "rule.definition", stage: "rule",
  summary: "A label whose row, set without a bar, states a definition names no rule: the row's sign is a defining one (≜, ≝, ≐, a \"def\" set over = or ⇔, ≜ drawn as = under a triangle, or msam's ≜ that reaches the text layer as a comma); or it defines by \"iff\" with no step (an arrow or turnstile) of its own; or, at the margin, it is one line giving a bare name its value by \"=\" with no other relation and no stroke under it. The row is read up to a side condition (\"where\", \"when\", \"if\"), and not into a neighbour's line the box runs into. Premises over a bar make a rule whatever its conclusion says. Iris-style laws, reductions and specifications set without a bar relate their sides by an entailment, an arrow or a triple, and stand; a reduction with an \"iff\" side condition stands. A label tagging a display that calls it definitions or a goal (\"Aux-Defs\", \"(Goal_op)\"), or a specification's name ending its triple at the right as an equation's tag (\"(runAsync-spec)\" in the text), labels that statement, no rule; a specification heading or over its triple in a figure of rules stands.",
  why: "Relaxed-memory papers set their relations as \"(happens-before)  hb ≜ (sb ∪ sw)⁺\" (or \"hb = (sb ∪ sw)⁺\") at the margin, Simuliris its value relation's clauses \"V ℓₜ ℓₛ ≜ ℓₜ ↔ₕ ℓₛ\" as (value-loc), Actris its protocols \"sort_protheadfg … ≜ μ(rec …)\", Backpack \"(stamps) K ν̄ ≝ μα.K ν̄\", a causal-consistency paper \"(R2) u ↷ q iff …\"; none is an inference rule, however the prose cites it. An abstract-interpretation paper defines its transfer functions by rules, Assume's conclusion \"N̂.assume(ê, Γ♯) ≜ Γ′♯\" under its bar; Evidently's (perform) steps \"iff op ∉ bop(E)\".",
  pattern: /≜|≝|≐|=△|△=|def\s?(?:=|⇔|⇐⇒|⟺|↔)|:⇔|:⟺/u,
  matches: ["hb ≜ (sb ∪ sw)+", "G.hb =△ (G.sb ∪ G.sw)+", "K νdef= μα.K ν", "Φ ` Φ′ deps-wfdef⇔ ∀ν", "half (add 𝑥 𝑥) ≐ 𝑥", "P :⇔ Q"],
  rejects: ["Γ ⊢ e : τ", "x := v", "ℓ ← v", "{P} x ≔ e {Q}", "e1 = e2", "P ⊣⊢ Q"],
});
export const RULE_CLAUSE = rule({
  id: "rule.clause", stage: "rule",
  summary: "A token whose row is a clause of a list or a proposition names no rule: the row opens with a bullet or an item's number (\"•\", \"1.\", \"(1)\", \"(ii)\"), or with a connective going on from the formula over it (∧, ∨), or, one line alone at the margin, with a quantifier, or it is a sentence (four words or more, most of the row, no relation between terms); so is a token ending a line that opens so, or heading words that make a sentence (\"No-duplicates (f_dup): There is another usage change\").",
  pattern: /^\s*(?:[•◦∙▪▸‣⁃]|(?:\d{1,2}[a-z]?|i{1,3}|iv|vi{0,3}|ix)[.)](?=\s)|\((?:\d{1,2}[a-z]?|i{1,3}|iv|vi{0,3}|ix)\)(?=\s|$))/u,
  matches: ["• acyclic(po ∪ rf)", "•", "(1) Φ ∧ x = y ⊨ Q = Q′", "10. (Π(A) = Π(B)) → …", "(ii) S(l, i) ≁ σ", "(1b) ∀x, h, t."],
  rejects: ["(λx. e) v → e[v/x]", "(e₁, e₂) ⇓ v", "1 + 2 = 3", "(i, j) ∈ po", "v ≁ σ (i)"],
  why: "Memory-model papers list a definition's consistency axioms as bullets with a label at the margin (\"• acyclic(po ∪ rf)  (No-Thin-Air)\"), the siblings in capitalised words already standing as no rule; a relational specification labels its conjuncts (\"∧ ∀x. decode(encode(x)) = x  (inversion)\"), a proof numbers its conditions (\"(1) … (Sufficiency)\"), RustBelt labels prose safety conditions (\"(Alloc-Safe)\"). None is an inference rule, and a box on each hides the list.",
});
export const RULE_BOX = rule({
  id: "rule.box", stage: "rule",
  summary: "A rule is as wide as its bar joined with its label, with the lines near its label's size (or a big operator set alone with its limits) within 0.8 of a leading of the bar and every line touching those within four leadings of the label (or down to the bar's conclusion), a premise in words over the bar, or a line set smaller than the running text, included, a caption never (a line more than twice the label's size is a broken font's, unless its lettered runs, a big brace's pieces aside, are no larger: a big operator); without a bar, it is the row its label stands in and the lines under it, the row as wide as its pieces set a blank apart; a conclusion (or, under its label, a specification) set over several lines runs on, each line hard under the last, its tall braces with it, and premises stacked over a bar reach up the same way until another bar, a note in the text's words or a row running across the bar's end (a table's); a conclusion's line run on hard under the last, nearer it than what follows, is no premise of the rule whose bar is under it, and a line hard by the rule's own bar is its though within reach of another; a specification's big bracket level with its line opens the rest of the triple, its lines the rule's, its foot carrying the stack on short of another label; a bar-less row is carried across a blank by a relation drawn as a stroke, and a row ending open (on a relation) runs on to the next line back at its start; stmaryrd's ⦇ ⦈ (read \"L\", \"M\") bracket a triple's pre- and postcondition as braces do. A line set into a rule (a group's heading), a numbered paragraph's head (\"G.2.6 [!C]. The rule is\") and, past the conclusion, a line over another bar are no part of it. Boxes never meet: a line two rules took belongs to the rule whose label it is or stands level with, or whose row it opens (a row broken over two lines, the label ending the second, set in past the first's start), else to the one whose bar (or label) it sits nearest, a label's rule never taking lines over its label's row, a big brace's piece (raised off its row, its depth lost) going to the bar-less row whose label's baseline is the first at or under its own; a bracketed label at the margin fences its row off from the next rule's box though its own name does not stand; two boxes still meeting are cut halfway across the blank between what each holds. A definition's head over a bar-less row (a line ending in ≜, msam's \",\" read so) and a \"where\" clause set out left of the row under it, with what stands on its line, are no rule's; a line hard over a bar-less row, left open by its relation and set out left of it with no label on its row, is the row's first, and its rule owns it; a label set under its formula's end takes nothing under it; a bar-less specification labelled at its middle takes nothing over the quantifier opening it where a triple closing in its brace stands hard over that line (the specification before).",
  why: "A rule's premises stand over a bar and its conclusion under; the name sits beside the bar or over it, and other rules may be set level with it. Polymorphic Contracts continues E_Fun's and E_Forget's rows with \"when\" lines under them, set in the text's face at the figure's smaller size; boxes that overlap make the showcase unreadable and a hover ambiguous. Pottier et al. set STREAM-APPEND's precondition, program and postcondition as a stack in tall braces under its label. A conclusion starting further under its bar (in big brackets), a side condition level with the bar a blank past its end, a big operator's glyph carrying the premises up, and a triple's pre- and postcondition in braces over and under a program ending its row belong to the rule; a heading (words in bold, a phrase closed by a colon), a label under the conclusion and a sentence under a specification do not. Persistency semantics sets T-If2's conclusion hard under its bar, a leading over T-Write's; refinement reflection wraps ∨-E's conclusion onto \"Right x2 → e2} : φ\" over ⇒-E's premises; math.h sets R3's three where-lines tight under its bar over R4's premise; CaReSL sets ACSQ under a table of atomic triples whose rows run past its bar; RustBelt Relaxed draws Raw-CInv-Model-Update's ⇛; the weak-isolation specs set their postconditions in tall ⟨ ⟩ under the program; verified interpreters close binop-eq-attr with \"dom e = dom d and … cover dom e}\"; Silq heads !C with \"G.2.6 [!C]. The rule is\". Axioms set side by side under their labels that the layout runs into one line, a label run into a formula of a table's next column, and a label run into a big brace's pieces are split apart first. GPS's consistentC11 definition heads its axioms with \"consistentC11(A, sb, mo, rf) ≜\", breaks Coherence's axiom after \"∀a, b. hb(a, b) ⟹\" and ends with \"where hb ≜ (sb ∪ sw)⁺\"; Terra sets (TAPP) over TUNWRAP's reduction; Lawyer opens releaseSpec with \"(∀𝜏, 𝜋, O, 𝑠ᵣ, 𝑄.\" under acquireSpec's postcondition \"{∃𝑠ᵣ ∉ O. …}𝜏\".",
});
export const RULE_MENTION = rule({
  id: "rule.mention", stage: "rule",
  summary: "A rule's name in running text cites the rule in the form its shape allows: a hyphenated name (its parts in any case where the prefix is as labelled, a line break after a hyphen allowed), a symbol or a spaced name in capitals as printed, bare or in brackets; a word or a spaced name with a capitalised word in brackets, or in its printed case within six words of \"rule\", \"law\" or \"axiom\", or anywhere when camelCase, or set off by a comma, an \"and\" or an \"and then\" from a hyphenated or spaced name's citation; \"the premise of\" before a word calls it a rule as \"rule\" does; a name ending in a subscript may stand a blank short of its closing bracket (\"(Detop )\"). Running text is a line whose other letters are in the text's face, or the name alone set as its label is. Labels do not cite themselves, nor does a word in a listing. A name is a whole name, not part of a longer hyphenated one; \"rule\" before it counts only within its sentence; and a label set in capitals or small capitals is not cited by the same word in lowercase set as the text around it, unless \"rule\" stands hard by (\"the bind rule\"). Inside the rule's own box the name is its label, not a mention (\"(T-∀-E𝑝)\" with its subscript on a line of its own).",
  why: "\"by T-App\", \"rule [LT-IF]\", \"the (BIND) law\", \"the sapp rule\", \"the Jump and Label rules\", \"T FUNC adds\", \"via containConcat\", \"raise, unw-intra-zone, and invoke\" and a proof case headed \"T CONTRACT\" point the reader at the rule; \"[Response]\" in a Haskell listing is a list type, \"case\" in prose is a word, and \"the elements of the pair\" with a rule named pair cited three lines on is prose, \"exactly the dual of\" is not the rule DUAL, and \"sim-vis\" in no-sim-vis-ex-comm is not the rule sim-vis.",
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
  // The title opens with a capitalised word; or the article "A" and a
  // capitalised word ("2 A TOUR OF…"), or a lower-case one after a number
  // closed by a point ("6.2. A program inverter") — not a unit's "A"
  // ("5 A current"), nor a run of letters ("2 A B C"); or a Greek letter
  // naming the paper's calculus ("4.1 λQC Kinding"), not a relation.
  pattern: /^(?<number>(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3})\.?\s+(?<title>(?:(?:[A-Z]\s+){3,}[A-Z]|[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F’'-]|A\s+[A-Z][A-Za-z]|(?<=\d\.\s+)A\s+[a-z]{2}|\d[A-Za-z]|[\u0391-\u03C9](?!\s*[=<>≤≥∈]))[^]*)$/,
  matches: ["2.1 Novel Methods", "2 RELATED WORK", "3 X-BRIDGES METHOD", "3. B R O W N I A N C O M P U T E R S", "2.3 3D Printing Manipulation with FDM", "3.2. Results", "A.1 Proof of Lemma 3", "4.3.1 Loose. Using the same material",
    "2 A TOUR OF TWO-LEVEL TYPE THEORY", "6.2. A program inverter for a reversible language", "4.1 λQC Kinding System"],
  rejects: ["2.1 of the paper", "A Study of Things", "2021 was a year", "1153 1163", "0.05 N), and the stroke", "2 A B C", "5 A current", "2 α = 0.5"],
});
export const SECTION_SPLIT_NUMBER = rule({
  id: "section.split-number", stage: "section",
  summary: "A line that is only a section number is read, as a candidate heading, with the one line level with it on its right — the same size, within four ems, and nothing else on the row.",
  why: "Books set a heading's number in a tab of its own (\"19.1\" | \"TRISECTION\"), which the layout rightly reads as two lines; neither alone is a heading (Geometric Folding Algorithms: 181 headings).",
});
export const SECTION_NOT_RUNNING_HEAD = rule({
  id: "section.not-running-head", stage: "section",
  summary: "A candidate heading in the page's top margin, level with a folio, is the running head naming the section the page is in, not a heading.",
  why: "A right-hand running head names a section too short to recur on three pages, so it is not furniture; taken for the heading, it also took the number from the real one on an earlier page.",
});
export const SECTION_HEADING_LEAD = rule({
  id: "section.heading-styled-lead", stage: "section",
  summary: "After section.heading, a subsection line (two numbers or more) set at the text's size heads its section when, past the number, it leads with bold or italic — the whole line (ending within the next two lines), or up to its first \".\" or \":\" with the paragraph running on (in the text's style somewhere after, whatever the word straight after the stop is set in) — and its parent and its predecessor (the parent, or the previous sibling) are headings already, no later in the paper.",
  why: "Elsevier and ASME set subsections in italic at the text's size (\"2.1. Metamaterials and auxetic materials\"), and run-in headings (\"1.2 Case Study Overview. The …\") put the title's style under half the line; both failed the bold-or-larger test (33 sections in three papers). A lead ending on a word the paper italicises anyway (\"3.3.3 Previewing Generated Motion. Kinergy provides …\", the system's name) ran on past its stop.",
});
export const SECTION_HEADING_STYLE = rule({
  id: "section.heading-style", stage: "section",
  summary: "After the other passes, a numbered line — any letter opening its title — heads its section when its number is set in the font and size of at least two headings already found at its depth and continues their numbering; an appendix's lone letter takes the top level's style, comes after the last numbered top-level heading, and runs A, B, C. Inside a float's box only when it fills a gap on both sides of the numbering (or, for a letter, when the box begins at it).",
  why: "A lower-case title (\"9 user study\"), an appendix letter (\"A Printing Settings…\"), and a heading a figure's band grew over fail the first pass; the paper's own heading style and numbering admit them without admitting list items or panel labels.",
});
export const SECTION_ROMAN = rule({
  id: "section.roman", stage: "section",
  summary: "A bold or larger line \"I. INTRODUCTION\", \"II. …\" heads a section when such lines run I, II, III … in reading order, three or more, none level with another.",
  why: "APS and IEEE papers number sections in Roman numerals, which section.heading does not read (20f979c959 had none).",
});
export const SECTION_SCANNED = rule({
  id: "section.scanned", stage: "section",
  summary: "On a scanned page, a numbered title in capitals alone on its row and narrower than the measure is a heading, in place of the bold-or-larger test.",
  why: "A scan's text layer has no bold and sizes that wander by half a point; the small-caps headings failed, and two run-in list items measured large were taken instead (Lamport, Shostak and Pease).",
});
export const SECTION_UNNUMBERED_NAME = rule({
  id: "section.unnumbered-name", stage: "section",
  summary: "A line alone on its row, set apart from the text (mostly bold, larger, or in capitals), narrower than the measure and outside any float, that is one of the names papers give their sections (\"Introduction\", \"Related Work\", \"Materials and Methods\", \"References\" …) heads an unnumbered section.",
  why: "A PDF with no outline still needs a contents for the Navigator, and what a paper leaves unnumbered — Abstract and References in a numbered paper, every heading in a journal's — section.heading never reads.",
  pattern: /^(?:abstract|summary|introduction|background|motivation|overview|preliminaries|related work|previous work|prior work|methods?|methodology|materials and methods|methods and materials|approach|experiments?|experimental setup|evaluation|results|results and discussion|discussion|analysis|limitations|future work|conclusions?|concluding remarks|conclusions? and future work|summary and conclusions?|acknowledge?ments?|references|bibliography|literature cited|works cited|appendix(?: [A-Z])?|appendices|supplementary material|supplementary information|statement of need|significance|data availability|code availability|author contributions|competing interests|funding)[.:]?$/i,
  matches: ["Introduction", "INTRODUCTION", "Related Work", "Materials and Methods", "References", "Acknowledgments", "Conclusions.", "Appendix A", "Statement of need"],
  rejects: ["Introduction to the theory", "The results show that", "In this section we", "Methods of proof are", "Figure 1"],
});
export const SECTION_CONTENTS_PAGE = rule({
  id: "section.contents-page", stage: "section",
  summary: "A numbered line with a bare page number level with it on its right, apart, is a contents entry; and a page with a line \"Contents\" (or \"Table of Contents\") on which three lines in ten end in a page number, and the pages after it that go on so, are the paper's table of contents: nothing on them heads a section.",
  why: "A book or thesis lists every heading ahead of itself; read as headings, those lines took each number from the chapter it names (Programming Languages: Application and Interpretation, 17 chapters all placed on page 3).",
});
export const SECTION_HEADING_FACE = rule({
  id: "section.heading-face", stage: "section",
  summary: "For the contents, a line is set apart from the text — as bold or a larger size set it apart for section.heading and section.roman — when it is in capitals, or every letter of it is upright and in a font that is not the text's and sets under 3% of the paper.",
  why: "IEEE sets \"I. INTRODUCTION\" in small capitals at the text's size, and some publishers' heading faces have names that say nothing of weight (\"AdvPS6F01\" beside the text's \"AdvPS6F00\"); either paper had no contents at all.",
});
export const SECTION_IN_SEQUENCE = rule({
  id: "section.in-sequence", stage: "section",
  summary: "For the contents, numbered sections are kept only where there are two or more; each when, in reading order, it is the next number or the one after; a subsection when its section is kept. A numbered line running on past a stop into more than eight words is a numbered paragraph, and leaves its number to a later line.",
  why: "A numbered list item or a figure's panel set in bold passes section.heading; in a contents it put \"15\" and \"21\" among sections 1 to 5.",
});
// What opens a line set like a heading and is not one, in any case.
const anyCase = (word: string) => word.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const NOT_A_HEADING = ["fig", "figure", "table", "tab", "eq", "equation", "theorem", "lemma", "proof", "definition", "corollary", "proposition", "remark", "example",
  "algorithm", "listing", "keywords", "keyword", "index terms", "general terms", "categories and subject descriptors", "ccs concepts", "acm reference format",
  "table of contents", "contents"].map(anyCase).join("|");
export const SECTION_UNNUMBERED_STYLE = rule({
  id: "section.unnumbered-style", stage: "section",
  summary: "After section.unnumbered-name, a line alone on its row, no wider than the measure, set in the font and size of the headings already found — two named ones, or one named and two more lines in its style that read as titles — and reading as a title (a capital, at most twelve words, no closing stop after a sentence), heads an unnumbered section too.",
  why: "A journal names only some of its sections from a common stock (\"Introduction\", \"Discussion\"); the rest (\"Graphene growth on copper\") share their style, which is the paper's own sign of a heading. A magazine may name only its \"References\": Physics Today's \"From Maxwell's demon to Landauer's eraser\" titles every other section (\"Maxwell and Szilard\", \"Dancing with the demon\") and had no contents.",
  pattern: new RegExp(`^(?=\\p{Lu})(?![IVX]{1,5}\\.\\s)(?!(?:${NOT_A_HEADING})\\b)(?!.*[.,;]$)(?:\\S+\\s+){0,11}\\S+$`, "u"),
  matches: ["Graphene growth on copper", "Statement of need", "THE ARCHITECTURE", "Why functional programming matters"],
  rejects: ["Figure 3", "Theorem 2.", "lower-case start of a sentence", "One two three four five six seven eight nine ten eleven twelve thirteen", "4.3 [D1] Discover", "II. METHODS", "Keywords", "General Terms", "It ends as a sentence does."],
});
export const MENTION_CITED = rule({
  id: "mention.cited", stage: "mention",
  summary: "A mention of a section, figure or table is no link when it points into a cited work: inside a citation's bracket after the citation and a comma (\"[Annenkov et al. 2019, Section 2.3]\", \"[16, Fig. 1]\", \"Lang (2003, Sec. 9.11)\"), or followed by \"of\"/\"in\" and a citation or the supplementary material (\"Figure 2 of Connelly et al. 2003\").",
  why: "The mention rules read the word and the number alone, and linked the cited paper's Section 2.3 to this paper's own (38 locators and ~29 figure credits across the corpus).",
});
export const MENTION_SECTION = rule({
  id: "mention.section", stage: "mention",
  summary: "\"Section\", \"Sec.\", \"Sect.\", \"§\" or \"Appendix\" followed by one or more section numbers — Arabic, Roman (\"Section II\") or an appendix letter (\"Appendix A.1\") (\"Section 2.1\", \"Sections 3 and 4\", \"§§2–4\") mentions each of them.",
  why: "Papers point the reader to their own sections as often as to their figures; the mention becomes a link to the heading.",
  pattern: /(?<kind>\b(?:Sections?|SECTIONS?|Sects?\.|Secs?\.|Appendix|Appendices|APPENDIX|App\.)|§§?)\s*(?<list>(?:\d{1,2}|[IVX]{1,5}(?![A-Za-z\d])|[A-Z](?![A-Za-z]))(?:\.\d{1,2}){0,3}(?:\s*(?:,|,?\s*and|,?\s*&|[-–—]|to)\s*(?:\d{1,2}|[IVX]{1,5}(?![A-Za-z\d])|[A-Z](?![A-Za-z]))(?:\.\d{1,2}){0,3})*)/,
  matches: ["(Section 2.1)", "in Section 2.3.", "Sections 3 and 4", "Sec. 4.2", "see §3.1", "Section A.2", "Section II presents", "Sec. VII", "Appendix A", "Appendix B.7"],
  rejects: ["this section", "Section", "the sections below", "Section In", "the appendix"],
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

// ------------------------------------------------------------- statements

// The words a statement opens with, as set: "Theorem", or in capitals
// ("THEOREM", which small capitals read as, the first letter sometimes
// apart: "T HEOREM").
const STATEMENT_WORDS = ["Theorem", "Lemma", "Proposition", "Corollary", "Definition", "Proof"]
  .map((w) => `${w}|${w[0]}\\s?${w.slice(1).toUpperCase()}`).join("|");
export const STATEMENT_LEAD = rule({
  id: "statement.lead", stage: "statement",
  summary: "A line that opens (after LIPIcs' ▶ if there is one) with Theorem, Lemma, Proposition, Corollary, Definition or Proof, set bold, italic or in capitals (or, with a stop, in the text's face when a theorem's italic words follow it, or when it is a proof: acmart's small capitals read as the text), then a number and a name in brackets if it has them (a name may run on to the next line), and a full stop or colon, opens that statement; with a number and no stop, only when the word is bold. Proofs may say what they prove (\"Proof of Lemma 2.\", \"Proof sketch.\").",
  why: "The nav bar marks where a paper states and proves things; amsthm, acmart, LIPIcs, LNCS and IEEE all open them this way, and a sentence that merely begins \"Theorem 3 shows\" is set in the text's face.",
  pattern: new RegExp(`^\\s*(?:[▶►▸]\\s*)?(?<word>${STATEMENT_WORDS})(?:(?<=roof|ROOF)\\s+(?:of|sketch|Sketch|outline|Outline)\\b[^]{0,80}?|\\s+(?<number>(?:[A-Z]\\.)?\\d{1,3}(?:\\.\\d{1,3}){0,2}))?(?:\\s*\\((?<name>[^()]{1,80})(?:\\)|(?<open>$)))?\\s*(?:(?<stop>[.:])(?=\\s|$)|(?<=\\d)(?=\\s|$)|$)`, "u"),
  matches: ["Theorem 3.1. Let e be", "Lemma 2 (Substitution). If", "Proof. By induction", "Definition 4 (Typing): A term", "THEOREM 3.1. For every", "T HEOREM 5. For", "▶ Lemma 7. For all", "Proof of Lemma 2.1. We", "Proof sketch. Consider", "Proof Outline. The result", "Proof of Lemma 2.8", "Theorem 4.1 (Vertex-language Automaton criterion, [Brotherston 2006; Lee et al.", "Corollary 1. The", "Proposition A.2. Every"],
  rejects: ["The theorem holds", "In Lemma 2 we", "Proofs are in the appendix", "Theorems 3 and 4 show", "Theorem of Pythagoras says", "Lemmas"],
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
  summary: "The title is the strongest block before the abstract, scored by type, position, text shape, nearby authors and agreement with document metadata.",
  why: "Publishers emphasize titles, but logos, diagrams and drop caps can be larger; the surrounding title block distinguishes them.",
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
  summary: "The conference an ACM reference paragraph on the first page names — \"In Proceedings of the … (CHI '23)\" — by its short name in parentheses is the paper's venue.",
  why: "ACM conference papers print how to cite them on their first page; a reader knows the conference by the short name, the one Crossref keeps with the event.",
  pattern: /\bIn Proceedings of the .{10,180}?\s*\((?<acronym>(?:[A-Z]{2,}|[A-Z][a-z]+)\s*['’]\s*\d\d)\)/,
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
export const HEADER_JOURNAL_ISSUE = rule({
  id: "header.journal-issue", stage: "header",
  summary: "An issue a \"Proc. ACM …\" citation line names by a word, not a number — \"Vol. 4, No. ICFP\", \"4, OOPSLA2,\" — is the conference whose papers fill it, and part of the venue.",
  why: "PACMPL publishes ICFP, OOPSLA, POPL and PLDI as issues of one journal; the issue is the name a reader knows the paper's venue by, and Crossref keeps it as the issue.",
  pattern: /\bProc\. ACM [A-Z][A-Za-z.\s-]*?[.,]?\s+(?:Vol\.\s*)?\d+,\s*(?:No\.\s*)?(?<issue>[A-Z][A-Za-z]*\d?)\s*,\s*Article\b/,
  matches: [
    "Proc. ACM Program. Lang., Vol. 4, No. ICFP, Article 109. Publication date: August 2020.",
    "Proc. ACM Program. Lang. 4, ICFP, Article 109 (August 2020), 31 pages.",
    "Proc. ACM Program. Lang., Vol. 7, No. OOPSLA2, Article 250. Publication date: October 2023.",
    "Proc. ACM Hum.-Comput. Interact., Vol. 5, No. CSCW1, Article 12. Publication date: April 2021.",
  ],
  rejects: ["Proc. ACM Meas. Anal. Comput. Syst., Vol. 6, No. 2, Article 31. Publication date: June 2022.", "ACM Trans. Graph., Vol. 38, No. 4, Article 62."],
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
