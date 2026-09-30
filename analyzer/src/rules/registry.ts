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
  summary: "A run smaller than its line and raised (or lowered) against it is a superscript (or subscript) of that line (a lone bracket, brace or bar stretched over a stack of lines bases none, and stands apart from the text beside it), unless it is a word of three letters or more set a quarter of the line's size or more past the line's end; touching two lines alike, it belongs to the nearer baseline. Scripts bridge a blank on a baseline only where they fill it without a gap wider than a word space.",
  why: "Nature, Science and Wiley papers cite with superscript numbers glued to the word before them; consistent subtyping sets CS-TVar a space past its conclusion, raised to the bar, in smaller type; RapunSL sets Pₓ's subscript against the ⨁ under it, and two rules' subscripts either side of the blank between them; a verified scheduler's specifications stretch a brace to 106pt over ten lines of 10pt text, which are no scripts of it.",
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
const RULE_SIGN = "(?:[+−±†‡♠♣♦*∗?!↓↑'′’-]{1,2})";
const RULE_PART = "(?:[\\p{L}\\d][\\p{L}\\d'′’]*" + RULE_SIGN + "?|[" + RULE_CONNECTIVES + "*∗|/]+[\\p{L}\\d" + RULE_CONNECTIVES + "*∗|/'′]*)";
export const RULE_NAME = "(?:[A-Z][\\p{L}]{0,19}|[a-zà-öø-ÿ]{1,8}|[a-z]{1,3}(?:\\|[a-z]{1,3})+|[a-z]{1,8}(?:[A-Z][a-z]{0,8}){1,2}|\\p{Script=Greek}{1,2}|[" + RULE_CONNECTIVES + "]{1,2})(?:[-‐‑–−:/_]" + RULE_PART + ")+(?: ?\\([\\p{L}\\d]{1,4}\\))?";

export const RULE_CANDIDATE = rule({
  id: "rule.candidate", stage: "rule",
  summary: "A line that is one token, or that opens or ends with one an em or more apart from the rest (or set off by a colon, which ends it after a letter; so closed it labels a rule only at a bar), may label a rule: up to 36 characters with no inner space (one between a one- or two-letter prefix and a capitalised word, before a trailing capital, digit or arrow, or before a parenthesised tag), a letter in it, opening with a letter, a digit or a symbol name's connective (\"→L\", \"<:eq\"), brackets that pair, not a number, a citation or a formula (every letter mathematical, or the first read from a symbol font: the ⟦ ⟧ of a denotation; after a connective, letters all mathematical with no capital among them, or all lowercase in an italic face: ⊕𝜎𝑓, × 1/fps). A piece of a large brace set at a token's end is no letter of it. The size a label is measured against is the text's, or the size most lines of a prose line's length are set in where that is larger; a line under 0.55 of it is a diagram's lettering (Sparse Workspaces labels a matrix's levels \"(Level J)\" at half the text's size).",
  why: "Every label in the corpus is set apart from its rule by a line break or a gap; none runs into prose. \"Cut\", \"(value)\", \"k-var\", \"E Beta\" and \"Definition\" all pass here and are told apart by their setting; Sequent Core's →R and ∀R open with their connective.",
});
export const RULE_BAR = rule({
  id: "rule.bar", stage: "rule",
  summary: "A rule's bar is a horizontal stroke (a path, a thin image, or a line of four or more dashes set as text, with digits on it or a star at its end) at least two label sizes wide (one and a third, level with the label or under it; one under the label where it is exactly as wide as the line under it) with a line under it within its span, not an edge of a box drawn round a form, not an arrow's shaft, not a word's underline, not a stroke inside a paragraph's line, not a stroke striking text through, not an overline with its index at its end, not a figure's or table's caption's rule; a stroke set close under a line is a bar where a conclusion as wide stands under it; one wider than 92% of the text column needs its conclusion centred under it and shorter, premises and a conclusion fitting it, or the label level with it and beside it. A bar a wider one runs under from its left edge ends a premise's own derivation, and the label over them names the wider.",
  why: "Dependent JavaScript paints its bars as thin images; Iris papers set a bar as a line of dashes in the text; Kind Inference boxes each judgement form and its bottom edge lies right over the labels under it; a rule spanning the page in Kind Inference and Featherweight Go keeps its conclusion centred, while a figure's own rule has its content set from the left. Kind Inference repeats premises over i under an overline; a dependent type theory sets Ctx-Empty's bar just as wide as its conclusion \"⊢ ·\"; Evidently strikes (tapp) through; a staging paper's CD-ST-DEF sets its bar close under wide premises.",
});
export const RULE_SETTING = rule({
  id: "rule.setting", stage: "rule",
  summary: "A token's setting to its bar and to the lines sharing its row is its category: beside the bar (the bar through its middle, the token outside its span, up to eight sizes off to the bar's right with blank between; or under the conclusion, its edge at the bar's, or reaching the conclusion's end from within the bar's span), over it (on its own line over the premises, aligned with the bar's left edge or middle, the premises within the bar's span, no other bar between but a premise's own or an overline, the bar as far down as seven leadings (fourteen where the premises run unbroken from the label to it), no label of its own beside it, no relation on the label's row clear of the bar that is not over a bar of its own; the premises one stack, no label set as this one between; a hyphenated, spaced or bracketed name over one line holding a relation between terms, big operators hanging from their baseline, stands over an axiom set without a bar, and stays so though a rule's conclusion over it is further off), at the end of a row with no bar (the rest of the row three characters or more and a relation level with the token: an arrow, a turnstile, an equation; a table's row of numbers and a paragraph's words are no rule; neither another label, a line hard under another label, nor a brace stretched over a stack of lines is on its row), or at the text column's right margin. Level with a bar on either side, the token stands on the side most of the paper's other labels do. Under a rule's label found over a bar, a token over the same bar within three leadings of the label, the bar within three and a half, is a premise.",
  why: "Sequent Core sets Cut beside its bar, TypeWhich sets Id's rule, then Const, then its rule on one row (Const is left of its bar, as Id is), Kind Inference k-var over (mathpar) and a-dt-decl over a stack of premises, the Awkward Squad (BIND) at a law's end, Polymorphic Contracts E Op in a column at the margin; \"1 INTRODUCTION\" has nothing on its row but a number. The JFP version of Polymorphic Contracts sets T_Var an inch right of its bar and SWF_Refine under its conclusion, short of the bar's end; a staging paper's ENV-R-EMPTY stands level with ENV-R-KVAR's premises.",
});
export const RULE_SHAPE_HYPHEN = rule({
  id: "rule.shape.hyphen", stage: "rule",
  summary: "A hyphenated name: a prefix of a capital and up to nineteen letters (up to eight when all lowercase, short lowercase modes joined by bars (c|q), camelCase, a lowercase word and one or two capitalised ones after it, one or two Greek letters, or one or two connectives), then one or more parts in any case, or of connectives, joined by a hyphen (a minus sign too, as Hyper Hoare Logic's text layer reads While−∀∗∃∗), a colon, a slash or an underscore, a part may end in a sign (a trailing hyphen too), and the name in a short parenthesised tag (\"T-App\", \"LT-APP\", \"k-var\", \"cmpList-Nil\", \"S-refl\", \"DEC-<:-BASE\", \"WF-var+\", \"WF-var-\", \"β-reduction\", \"T:Proc\", \"≤-Base\", \"Sem-⊤\", \"cbncoeff-app\", \"extS-addSk\"); Curry-Howard is one by shape and told apart by its setting.",
  why: "acmart's small capitals reach the text layer in lowercase, so the parts may be in any case; \"call-by-name\" and \"well-typed\" are names by shape and told apart by their setting. Generic Refinement Types ends names in a sign, Hyper Hoare Logic in a quantifier, Ownership Types in a colon; PACMPL papers since 2024 prefix names with a judgment's whole word (MAInconsistentTypes-C, bigbmix-frame) or a connective (≤-Base) and end parts in one (Sem-⊤, bdg-∂).",
  pattern: new RegExp("^" + RULE_NAME + "$", "u"),
  matches: ["T-App", "LT-APP", "E-Beta", "WT-Fun", "DEC-<:-BASE", "S-Trans", "R-IfTrue", "Ty-Lam", "E-β", "T-App-Abs", "S-refl", "k-var", "pgm-dt", "t-named", "C-trans", "a-kapp-kuvar", "WF-var+", "Rel-Fun±", "β-reduction", "T:Proc", "Step/Seq", "Program_E", "While-∀*∃*", "DS-∀", "PiggyBank-Persist", "coeff-var", "tcwf-app", "Curry-Howard", "call-by-name", "thoare-inv", "η-Red", "WF-var-", "MAInconsistentTypes-C", "bigbmix-frame", "cbncoeff-app", "extS-addSk", "cmpList-Cons", "T-Letmod’", "E-Op♠†", "Sem-⊤", "≤-Base", "Prf-⊃-Intro", "bdg-∂", "c|q-Splice", "c|q-Sub-Expr", "⪯-Base", "While−∀∗∃∗", "naïve-⊕PL"],
  rejects: ["T-", "-App", "jump", "T-App:", "(T-App)", "Choice(L)", "|q-Nat"],
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
  summary: "A single word of two to twenty-four letters and digits, primed or not, with or without a short parenthesised tag, spaced or not, or an abbreviation (a period after it) with a case of up to eight letters in parentheses (\"Cut\", \"BIND\", \"step\", \"InstLSolve\", \"MKSRelocationConflict\", \"MKSIf’\", \"A1\", \"Choice(L)\", \"LChoice (L)\", \"SeqCompDiv (1)\", \"cong. (variadic)\").",
  why: "Slotted E-Graphs sets cong. (variadic), cong. (bind) and cong. (f) beside their bars and cites cong. (bind); Sequent Core, the Awkward Squad and Consistent Subtyping name rules with one word; where it stands decides whether it labels a rule.",
  pattern: /^\p{L}[\p{L}\d\p{Co}]{1,23}['′’]?(?: ?\([\p{L}\d]{1,4}\)|\. \(\p{L}{1,8}\))?$/u,
  matches: ["Cut", "BIND", "step", "InstLSolve", "A1", "jump", "Choice(L)", "FixedPoint(Err)", "LChoice (L)", "SeqCompDiv (1)", "MKSRelocationConflict", "MKSIf’", "cong. (bind)", "cong. (variadic)"],
  rejects: ["a", "1", "T-App", "E Beta", "Cut:", "verylongwordthatisnotaname", "cong.", "cong.(bind)"],
});
export const RULE_SHAPE_SYMBOL = rule({
  id: "rule.shape.symbol", stage: "rule",
  summary: "A symbol name: one or two connectives, or a digit or a truth constant, with one to three side letters and a digit (\"→L\", \"∀R\", \"⊗L\", \"×T\", \"+I0\", \"1I\", \"⊕PR\", \"⊤T\"), a connective with a digit or ∞ (\"⋍0\", \"=0\", \"=inf\") or a word of two to twelve letters or a Greek letter, with a side after a slash (\"∼Empty\", \"<:eq\", \"<:reft/l\", \"≡inst\", \"≡κ/l\"), one or two capitals and a connective (\"L→\"), or a capitalised word, a connective and one to three lowercase letters (\"St+i\", \"St+uu\"), as sequent calculi and logical relations name their rules.",
  why: "Sequent Calculus as a Compiler IR names →L and ∀R beside their bars and cites them so; a call-by-push-value paper names ×T, +T, 1I and &T after the connective; a bidirectional typing paper names ∼Empty, ⋍0 and ⋍∞; PACMPL subtyping and equivalence papers name <:eq, <:reft/l and ≡inst after the relation; a bidirectional typing paper names its addition's steps St+i and St+uu after the step judgment.",
  pattern: new RegExp("^(?:[" + RULE_CONNECTIVES + "]{1,2}(?:[A-Z]{1,3}\\d?|\\d|∞|\\p{L}{2,12}(?:/\\p{L}{1,2})?|\\p{Script=Greek}(?:/\\p{L}{1,2})?)|[\\d⊤⊥][A-Z]{1,3}\\d?|[A-Z]{1,2}[" + RULE_CONNECTIVES + "]{1,2}|[A-Z][a-z]{1,11}[" + RULE_CONNECTIVES + "]\\p{Ll}{1,3})$", "u"),
  matches: ["→L", "∀R", "⊗L", "L→", "∀L", "×T", "+I0", "&T", "1I", "⊕PR", "⊲V", "⋍0", "⋍∞", "∼Empty", "<:eq", "<:reft/l", "≡inst", "≡κ/l", "~Cons", "=0", "=inf", "⊤T", "▷V", "St+i", "St+uu", "?R", "!L"],
  rejects: ["→", "L", "→→→L", "→l", "12", "∞", "<:a"],
});
export const RULE_SHAPE_SHORT = rule({
  id: "rule.shape.short", stage: "rule",
  summary: "A short name: one to three signs, digits and Greek letters with a connective, an exponential (! ?) or a Greek letter among them and at most two Latin letters, or a bar and one to three such (\"⊗\", \"!\", \"1⊥\", \"!w\", \":π1\", \"|⊗\", \"|w\", \"=α\", \"β→\", \"μ\", \"β+0\", \"cc→\"), one upright letter or digit alone (\"c\", \"1\"), or a type's letter and a mathematical capital (\"U 𝐼\"); a letter read from a symbol font is a glyph (⋆ here: ⅋ reaches the text layer as stmary's \"O\"). Beside a bar it stands where two more labels stand beside bars on its page, on its side, and, made of signs alone, where the paper names two rules so; elsewhere only in brackets, in a column of labels set alike. A letter in a drawn ring is a marker, a Latin letter or digit in brackets an item's or an equation's tag unless beside a bar of its own on a page of labels named by glyphs (\"(1)\" by \"(𝜔)\" and \"(𝜌)\"), a connective before a math letter a formula (\"¬𝜑\"). It is cited only with \"rule\" by it, or in brackets with a sign and a letter, set as its label is.",
  why: "Better Late Than Never names the rules of linear logic by their connective (⊗, ⅋, 1, ⊥, !, ?, W, C) and their transitions :π1, |⊗, !?; Sequent Core names its machine steps (β→), (β∀), (μ) and its rules ∀, ∃×; Call-by-Unboxed-Value (β×), (η&), (𝑐𝑐→), U 𝐼. Each is cited as \"rule !\", \"rules c and w\"; a bare \"1\" or \"!\" in prose is a number or a sign, a lone \"?\" beside a bar an open goal, a \"⊥\" at a diagram's edge a type.",
  pattern: new RegExp("^(?=[^A-Za-z]*(?:[A-Za-z][^A-Za-z]*){0,2}$)(?:\\|[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}\\dA-Za-z]{1,3}|(?=.*[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}])(?![:=<~+&*]$)[" + RULE_CONNECTIVES + "!?\\p{Script=Greek}\\dA-Za-z]{1,3}|[A-Za-z\\d])$", "u"),
  matches: ["⊗", "⊥", "1", "!", "?", "⋆", "c", "W", "⊕1", "!?", "!w", ":π1", "|⊗", "|w", "=α", "1⊥", "⊗⋆", "⊕1⋆", ":⋆0", "π", "μ", "β→", "β∀", "∃×", "β+0", "η&", "βλ", "cc→", "|c", ":C"],
  rejects: ["12", "→→→L", "abc", "T-App", "x+y+z", "ab", "|", ":", "abc→", "(1)"],
});
export const RULE_SHAPE_PHRASE = rule({
  id: "rule.shape.phrase", stage: "rule",
  summary: "A phrase of two to four words, the first capitalised, in parentheses at the end of a row, in a column of two or more labels set alike (\"(Sequential composition)\", \"(Left choice)\", \"(Fixed point)\" among \"(One)\" and \"(Some)\"): alone, such a phrase is prose.",
  why: "Shoggoth labels the rows of its denotational semantics (Sequential composition), (Left choice) and (Fixed point) in the column where it sets (One), (Some) and (All).",
  pattern: /^\p{Lu}\p{Ll}+(?: \p{L}+\.?){1,3}$/u,
  matches: ["Sequential composition", "Left choice", "Nondeterministic choice", "Fixed point", "Case of known constr."],
  rejects: ["Cut", "left choice", "E Beta", "A b c d e"],
});
export const RULE_SHAPE_TITLE = rule({
  id: "rule.shape.title", stage: "rule",
  summary: "A titled name: one to three capitalised words, each maybe hyphened, then a parenthesised case of one to three capitalised words, or two to three such words alone, making up the label's whole line (\"Free Ok\", \"Nondeterministic Lifting\", \"One-Sided If\", \"Under-Approx Left\", \"If (Multi-Outcome)\", \"If (Single Outcome)\"). It is weak, as a word is: it stands beside a bar only as the convention allows (rule.convention), and never over a bar, at a row or at the margin, where such words head a group of rules, a table's rows or a figure's part (\"Well-formed Type\", \"Prior Work\", \"Monadic Rules\").",
  why: "Outcome Logic sets its rules' names in small capitals beside their bars, Free Ok, Store Er, Error Propagation and If (Multi-Outcome) among Error, Alloc and Frame, and cites them \"the Error Propagation rule\"; small capitals reach the text layer as a capital and lowercase letters, so the words read as a title.",
  pattern: /^(?=\S+ )\p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}){0,2}(?: \(\p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}(?: \p{Lu}\p{L}{0,19}(?:-\p{L}{1,19}){0,2}){0,2}\))?$/u,
  matches: ["Free Ok", "Store Er", "Nondeterministic Lifting", "Error Propagation", "One-Sided If", "Under-Approx Left", "If (Multi-Outcome)", "If (Single Outcome)", "Bounded Unrolling"],
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
  summary: "At the end of a row, a name is hyphenated, spaced, or a bracketed word; at the head of a row that reduces (an arrow between its sides), a bare word too, standing as the convention allows (rule.convention).",
  why: "(BIND), (lamr), T FUNC; app, beta and invoke in small capitals heading reductions among unw-inter-zone and unw-intra-zone; a bare word ending a row is the grammar's category (\"program\", \"Syntax\") or a heading (\"INTRODUCTION\"), and one heading a judgment's row names its form (\"Typing\" before Γ ⊢ 𝑒 : 𝜏).",
});
export const RULE_NAME_MARGIN = rule({
  id: "rule.name.margin", stage: "rule",
  summary: "At the margin, a name is hyphenated, spaced, a word in square brackets, or a parenthesised word in lower case, which stands only as the convention allows (set as two strong names are, or cited); a capitalised parenthesised word there heads a group of rules or labels an example.",
  why: "E Op, E Beta in a column at the margin; [Int] and [Var] at the margin of a typing rule set as one line; StackKAT's (filter) between (push-pop) and (pop-push); (Kinding) at the margin over the kinding rules and (C1) beside an example are not cited as rules.",
});
export const RULE_NAME_LETTERS = rule({
  id: "rule.name.letters", stage: "rule",
  summary: "A hyphenated name has a letter or a connective past its hyphen, and a label's line is no larger than 1.2 times the body size. A name set wholly as a script of its line (raised or lowered) is none.",
  why: "sql-01 in a benchmark table is a name of digits; \"4.5 Kinding\" is a section heading.",
});
export const RULE_CONVENTION = rule({
  id: "rule.convention", stage: "rule",
  summary: "Labels sharing a category, side, bracket style, faces (of the name itself) and size are a paper's convention. A single-word label (or a spaced name ending in a digit or an arrow) stands only where the text cites it in the form its setting allows, or in a convention of two or more of which the text cites one, or in a convention two hyphenated, spaced or symbol names share; those stand alone. In a paper of rules — eight or more hyphenated, spaced or symbol names at bars — a bare word at a bar in the face and size two of those names share stands; so does a camelCase word at a bar in a convention of five.",
  why: "Sequent Core sets Cut, Case and Jump the same way beside their bars and cites Cut; Definition in a table's header stands alone and is never cited; a benchmark table's headers, a plot's legend and a diagram's labels are set alike by the dozen, and none is ever cited as a rule. Iris and separation logic papers set Löb, Work and LET among dozens of hyphenated names and never cite them by name; Hazelnut sets its camelCase names by the dozen and cites none.",
});
export const RULE_HEADING = rule({
  id: "rule.heading", stage: "rule",
  summary: "A token level with a grammar production (::=, or a | alternative under one) comments the production; a bare token set in a listing's monospace face is code (a bracketed one names a lemma), unless the paper sets five or more labels at bars in that face; a bracketed word at the margin with only a form level with it heads a group of rules or labels an example, as does a bare word over a bar with a hyphenated, spaced or symbol name between it and the bar, or with one set as three times as many of the paper's labels are. None names a rule. A hyphenated, spaced or symbol name set smaller than a label, between it and the bar under it, labels that bar; the label over it heads the group (\"Implements\" over <:-Param).",
  why: "\"(value)\" beside \"e ::= v\", \"(Kinding)\" at the margin right of \"Σ ⊢ τ : κ\" and \"(C1)\" beside an example are not cited as rules; \"(BIND)\" stands at the right of a law set in from the margin; \"(Reduction)\" stands in italics over R-Proj2Beta's rule, \"All\" underlined over allEmpty; omit_all_labels(t) is a listing's line over an example.",
});
export const RULE_DERIVATION = rule({
  id: "rule.derivation", stage: "rule",
  summary: "A bar with a narrower bar just over it (under the label, for a label over its bar) within its span, and a line between within the upper bar's span, or one whose conclusion leads into a wider bar under it that no label of its own names and that has a conclusion of its own under it (not running text or the next row's labels: a table's rule), is a step (the line between holding a letter or digit, not a row of vector arrows) of a derivation tree; so is a bar whose tree does not nest (a step to one side of the bar it leads into, or wider than it) where the two share half the narrower's span and the line between, a judgment over the lower bar and mostly under the upper, stands alone there; a bar leading into a step, and a label at a step's bar, are steps too; a stroke in a heading's rule, a table's rule, a frame's edge, a subterm's or subscript's overline and a boxed step inside a rule's conclusion are no steps; a label at a step cites its rule and never defines it.",
  why: "Mechanizing Refinement Types and Frame Inference for Rust set example derivations with each step labelled by its rule; a link to the name should open the rule, not the example.",
});
export const RULE_CELL = rule({
  id: "rule.cell", stage: "rule",
  summary: "A token level with a bar and within its span is a cell over a table's rule, as is one between two rules of one span with the upper right over it; one with the bar touching it on both sides heads a group; one with a vertical rule drawn through its row within three sizes, or a wall (an upright stroke, or the edge of a box taller than two lines) between it and its row, is in a table, a box round a judgment's form beside it aside; a row holding words in the text's face and no relation is a table's, and so is one with numerals under it beside the token (a row's heading at most to their left), however its cells are ruled. An upright closed at both ends by strokes across is a judgment's box, not a wall, unless those strokes close three uprights or more: a grid's row (ticks and \"n/a\" in a table of formats).",
  why: "Program, Line, Char over a table's rule; MLKit over a column of timings, underlined where they improve; \"——— Structural ———\" between groups of rules, while [fvar] has a gap before the next rule's bar; (base) and (offset) in a ruled table's cell.",
});
export const RULE_BOX = rule({
  id: "rule.box", stage: "rule",
  summary: "A rule is as wide as its bar joined with its label, with the lines within 0.8 of a leading of the bar and every line touching those within four leadings of the label (or down to the bar's conclusion), a premise in words over the bar, or a line set smaller than the running text, included, a caption never; without a bar, it is the row its label stands in and the lines under it, the row as wide as its pieces set a blank apart; a conclusion (or, under its label, a specification) set over several lines runs on, each line hard under the last, its tall braces with it, and premises stacked over a bar reach up the same way until another bar or a note in the text's words. A line set into a rule (a group's heading) and, past the conclusion, a line over another bar are no part of it. Boxes never meet: a line two rules took belongs to the rule whose label it is or stands level with, or whose row it opens (a row broken over two lines, the label ending the second, set in past the first's start), else to the one whose bar (or label) it sits nearest, a label's rule never taking lines over its label's row; two boxes still meeting are cut halfway across the blank between what each holds.",
  why: "A rule's premises stand over a bar and its conclusion under; the name sits beside the bar or over it, and other rules may be set level with it. Polymorphic Contracts continues E_Fun's and E_Forget's rows with \"when\" lines under them, set in the text's face at the figure's smaller size; boxes that overlap make the showcase unreadable and a hover ambiguous. Pottier et al. set STREAM-APPEND's precondition, program and postcondition as a stack in tall braces under its label.",
});
export const RULE_MENTION = rule({
  id: "rule.mention", stage: "rule",
  summary: "A rule's name in running text cites the rule in the form its shape allows: a hyphenated name (its parts in any case where the prefix is as labelled, a line break after a hyphen allowed), a symbol or a spaced name in capitals as printed, bare or in brackets; a word or a spaced name with a capitalised word in brackets, or in its printed case within six words of \"rule\", \"law\" or \"axiom\", or anywhere when camelCase, or set off by a comma, an \"and\" or an \"and then\" from a hyphenated or spaced name's citation. Running text is a line whose other letters are in the text's face, or the name alone set as its label is. Labels do not cite themselves, nor does a word in a listing.",
  why: "\"by T-App\", \"rule [LT-IF]\", \"the (BIND) law\", \"the sapp rule\", \"the Jump and Label rules\", \"T FUNC adds\", \"via containConcat\", \"raise, unw-intra-zone, and invoke\" and a proof case headed \"T CONTRACT\" point the reader at the rule; \"[Response]\" in a Haskell listing is a list type, \"case\" in prose is a word, and \"the elements of the pair\" with a rule named pair cited three lines on is prose.",
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
  pattern: /^(?<number>(?:\d{1,2}|[A-Z](?=\.\d))(?:\.\d{1,2}){0,3})\.?\s+(?<title>(?:[A-Z\u00C0-\u00DE][A-Za-z\u00C0-\u024F’'-]|A\s+[A-Z][A-Za-z]|(?<=\d\.\s+)A\s+[a-z]{2}|\d[A-Za-z]|[\u0391-\u03C9](?!\s*[=<>≤≥∈]))[^]*)$/,
  matches: ["2.1 Novel Methods", "2 RELATED WORK", "3 X-BRIDGES METHOD", "2.3 3D Printing Manipulation with FDM", "3.2. Results", "A.1 Proof of Lemma 3", "4.3.1 Loose. Using the same material",
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
  summary: "After section.unnumbered-name, a line alone on its row set in the font and size of at least two headings already found — named ones, or the numbered sections — and reading as a title (a capital, at most twelve words, no closing stop after a sentence), heads an unnumbered section too.",
  why: "A journal names only some of its sections from a common stock (\"Introduction\", \"Discussion\"); the rest (\"Graphene growth on copper\") share their style, which is the paper's own sign of a heading.",
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
