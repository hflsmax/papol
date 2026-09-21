// GROBID's TEI, read into a reference list, the in-text markers that
// point at it, and the cross-references to figures, tables and boxes.
//
// GROBID hands back both halves of what makes a bibliography clickable:
// the works cited, each with the raw string the author typed, and a box
// on the page for every in-text marker. Kept apart from the request so
// it can be tested against a saved document without a service running.

import { parseXml, XmlElement, XmlNode, XmlText } from "@rgrove/parse-xml";

import { extractArxivId } from "./identifiers";

export interface Reference {
  key: string; // GROBID's xml:id, e.g. "b11" — what markers target
  index: number; // position in the list, 0-based
  raw: string | null; // the reference exactly as printed, for matching
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  arxiv_id: string | null;
  // Where the entry itself is printed, so a PDF's own citation links —
  // which point at a place, not at an id — can be matched to it.
  page: number | null;
  y: number | null;
}

export interface Box { page: number; x: number; y: number; w: number; h: number }

export interface Citation extends Box {
  key: string; // the reference it points at
  label: string; // what is printed, e.g. "[13]"
  // True when the analyzer found the marker but could not say which entry
  // it meant, and Papol read the number instead: a guess.
  inferred: boolean;
}

export interface DocumentLink extends Box {
  kind: string;
  label: string;
  target_page: number;
  target_y: number;
}

export interface Analysis { references: Reference[]; citations: Citation[]; links: DocumentLink[] }

export interface HeaderMetadata {
  title: string | null;
  authors: string[];
  journal: string | null;
  year: number | null;
  // What the header prints, or what CrossRef told GROBID when the header
  // was consolidated: how the upload is looked up in the indexes.
  doi: string | null;
  arxiv_id: string | null;
}

// ------------------------------------------------------------- the tree

const isElement = (node: XmlNode): node is XmlElement => node instanceof XmlElement;

function* descendants(node: XmlElement, name?: string): Generator<XmlElement> {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (!name || child.name === name) yield child;
    yield* descendants(child, name);
  }
}

function children(node: XmlElement | null, name: string): XmlElement[] {
  return node ? node.children.filter((c): c is XmlElement => isElement(c) && c.name === name) : [];
}

type Step = { name: string; attr?: [string, string] };

// A path of child names, each optionally qualified by one attribute, as
// ElementTree spelled it: "analytic/title[@level='a']".
function find(node: XmlElement | null, path: Step[]): XmlElement | null {
  let current: XmlElement | null = node;
  for (const step of path) {
    current = children(current, step.name).find((c) => !step.attr || c.attributes[step.attr[0]] === step.attr[1]) ?? null;
    if (!current) return null;
  }
  return current;
}

function text(node: XmlElement | null): string | null {
  if (!node) return null;
  const words = node.text.split(/\s+/).filter(Boolean).join(" ");
  return words || null;
}

// The element's own words, leaving out what its children say.
function ownText(node: XmlElement | null): string | null {
  if (!node) return null;
  const own = node.children.filter((c): c is XmlText => c instanceof XmlText).map((c) => c.text).join("");
  const words = own.split(/\s+/).filter(Boolean).join(" ");
  return words || null;
}

function parse(xml: string): XmlElement {
  const root = parseXml(xml).root;
  if (!root) throw new Error("GROBID returned no document");
  return root;
}

// ------------------------------------------------------------ the header

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "over", "per", "the", "to", "via", "with", "without", "yet"]);

// Undo display-only all-caps styling in a header title. Mixed-case titles
// pass through untouched; an all-caps heading takes ordinary title casing
// while short acronyms stay, and a leading X-name (XGrammar, XLA) keeps
// its X as a prefix.
export function normalizeTitle(title: string | null): string | null {
  if (!title) return title;
  const letters = title.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return title;
  const parts = title.match(/[A-Za-z]+|[^A-Za-z]+/g) ?? [];
  const wordIndexes = parts.map((p, i) => (/^[A-Za-z]+$/.test(p) ? i : -1)).filter((i) => i >= 0);
  const first = wordIndexes[0], last = wordIndexes[wordIndexes.length - 1];
  let afterColon = false;
  parts.forEach((part, index) => {
    if (!/^[A-Za-z]+$/.test(part)) {
      if (part.includes(":")) afterColon = true;
      return;
    }
    const lower = part.toLowerCase();
    if (SMALL_WORDS.has(lower) && index !== first && index !== last && !afterColon) parts[index] = lower;
    else if (part.length <= 4 && !SMALL_WORDS.has(lower)) parts[index] = part;
    else if (index === first && part.startsWith("X") && part.length > 5) parts[index] = "X" + lower[1].toUpperCase() + lower.slice(2);
    else parts[index] = lower[0].toUpperCase() + lower.slice(1);
    afterColon = false;
  });
  return parts.join("");
}

function personName(person: XmlElement): string | null {
  const parts = [...descendants(person)].filter((p) => p.name === "forename" || p.name === "surname").map(text).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

export function parseHeader(xml: string): HeaderMetadata {
  const root = parse(xml);
  const bibl = [...descendants(root, "sourceDesc")].map((s) => children(s, "biblStruct")[0]).find(Boolean) ?? null;
  if (!bibl) throw new Error("GROBID returned no bibliographic header");
  const title = normalizeTitle(text(find(bibl, [{ name: "analytic" }, { name: "title", attr: ["type", "main"] }])));
  const authors = children(find(bibl, [{ name: "analytic" }]), "author").map((a) => {
    const person = children(a, "persName")[0];
    return person ? [...person.children].filter((p): p is XmlElement => isElement(p) && (p.name === "forename" || p.name === "surname")).map(text).filter(Boolean).join(" ") : "";
  }).filter(Boolean);
  const journal = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "j"] }]));
  const when = find(bibl, [{ name: "monogr" }, { name: "imprint" }, { name: "date" }])?.attributes.when;
  const year = when && /^\d{4}/.test(when) ? Number(when.slice(0, 4)) : null;
  const { doi, arxiv } = identifiers(bibl);
  return { title, authors, journal, year, doi, arxiv_id: arxiv };
}

// The DOI and arXiv id among a biblStruct's <idno> elements, bare: no
// resolver prefix, no "arXiv:".
function identifiers(bibl: XmlElement): { doi: string | null; arxiv: string | null } {
  let doi: string | null = null, arxiv: string | null = null;
  for (const idno of descendants(bibl, "idno")) {
    const kind = (idno.attributes.type ?? "").toLowerCase(), value = text(idno);
    if (!value) continue;
    if (kind === "doi" && !doi) doi = value.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
    else if (kind === "arxiv" && !arxiv) arxiv = value.replace(/^arxiv:\s*/i, "").trim();
  }
  return { doi, arxiv };
}

// ---------------------------------------------------------- the full text

// A citation marker's number, as printed: "[8]", "(3)", "[9," or the "[2]"
// in "Curry [2]". The bracket is required — without it every year and
// section number in the text would look like a citation.
const MARKER_NUMBER = /[[(]\s*(\d{1,3})/;
// The number set beside a display equation: a bare one in round brackets
// and nothing else. "(2016)" is a year, "[7]" the very thing this must
// not touch.
const EQUATION_NUMBER = /^\(\s*\d{1,3}\s*\)$/;
const CROSS_REFERENCE_KIND = /\b(box|fig(?:ure)?|table)\s*$/i;
const TARGET_HEADING = /^\s*(box|fig(?:ure)?|table)\s*([\w.-]+)/i;
// GROBID's figure-reference tag contains only the label: "Figure " is
// outside the tag, and in the source font that prefix is about three ems.
const FIGURE_PREFIX_EMS = 3.0;
const EARLIEST_YEAR = 1500, LATEST_YEAR = 2100;

type Pages = Map<number, [number, number]>;

// GROBID's "page,x,y,width,height;…" as fractions of each page. GROBID
// measures from the top-left in PDF points, the space pdf.js lays its
// text layer out in.
function boxes(coords: string | undefined, pages: Pages): Box[] {
  const out: Box[] = [];
  for (const box of (coords ?? "").split(";")) {
    const parts = box.split(",");
    if (parts.length !== 5) continue;
    const [page, x, y, w, h] = parts.map(Number);
    if (!Number.isInteger(page) || [x, y, w, h].some(Number.isNaN)) continue;
    const [width, height] = pages.get(page) ?? [0, 0];
    if (!width || !height) continue;
    out.push({ page, x: x / width, y: y / height, w: w / width, h: h / height });
  }
  return out;
}

// The first plausible year among these, in the order given. Nothing in a
// bibliography predates printing; nothing in it is in the future.
function yearIn(...sources: (string | null | undefined)[]): number | null {
  for (const source of sources) {
    for (const match of (source ?? "").matchAll(/\d{4}/g)) {
      const year = Number(match[0]);
      if (year >= EARLIEST_YEAR && year <= LATEST_YEAR) return year;
    }
  }
  return null;
}

function referenceFrom(bibl: XmlElement, key: string, index: number, pages: Pages): Reference {
  const raw = text(children(bibl, "note").find((n) => n.attributes.type === "raw_reference") ?? null);
  // The title lives under <analytic> for a paper in a journal and under a
  // level="m" <monogr> title for anything standalone. No fallback to an
  // unqualified monograph title: GROBID commonly emits a journal title
  // there, and a venue is not the cited work's title.
  let title = text(find(bibl, [{ name: "analytic" }, { name: "title", attr: ["level", "a"] }]));
  let proceedings = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "m"] }]));
  if (!title) { title = proceedings; proceedings = null; }
  // A journal names itself at level="j"; a conference paper names its
  // proceedings at level="m" beside its own title, and GROBID sometimes
  // puts the conference in <meeting> alone, whose children are the address.
  const journal = text(find(bibl, [{ name: "monogr" }, { name: "title", attr: ["level", "j"] }])) || proceedings
    || ownText(find(bibl, [{ name: "monogr" }, { name: "meeting" }]));
  const authors = [...descendants(bibl, "persName")].map(personName).filter((n): n is string => Boolean(n));
  const date = find(bibl, [{ name: "monogr" }, { name: "imprint" }, { name: "date" }]) ?? [...descendants(bibl, "date")][0] ?? null;
  // The @when attribute first, then what the element says: a reference
  // ending "178–190" comes back as when="0190" with the text still reading
  // "2016. 190", and the text is the one to believe.
  const year = date ? yearIn(date.attributes.when, text(date)) : null;
  const ids = identifiers(bibl);
  const doi = ids.doi, arxiv = ids.arxiv ?? extractArxivId(raw ?? "");
  // Only the first box: an entry may wrap over several lines, and where
  // it starts is what a link into it points at.
  const first = boxes(bibl.attributes.coords, pages)[0];
  return { key, index, raw, title, authors, year, journal, doi, arxiv_id: arxiv, page: first?.page ?? null, y: first?.y ?? null };
}

// The reference a numeric marker points at, counting from one. Only
// trustworthy where the bibliography is numbered in the order it is
// printed; a number past the end of the list is left alone.
function numberedTarget(label: string, references: Reference[]): string | null {
  const match = label.match(MARKER_NUMBER);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= references.length ? references[n - 1].key : null;
}

function linkKind(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith("fig") ? "figure" : lower;
}

// The last forty characters of text before each element, in document
// order: what "Figure" or "Box" was printed just before a marker.
function precedingText(root: XmlElement): Map<XmlElement, string> {
  const prefixes = new Map<XmlElement, string>();
  let preceding = "";
  const visit = (element: XmlElement) => {
    for (const child of element.children) {
      if (child instanceof XmlText) preceding = (preceding + child.text).slice(-40);
      else if (isElement(child)) { prefixes.set(child, preceding); visit(child); }
    }
  };
  visit(root);
  return prefixes;
}

export function parseTei(xml: string): Analysis {
  const root = parse(xml);
  const pages: Pages = new Map();
  for (const surface of descendants(root, "surface")) {
    const n = Number(surface.attributes.n), lrx = Number(surface.attributes.lrx), lry = Number(surface.attributes.lry);
    if (Number.isInteger(n) && !Number.isNaN(lrx) && !Number.isNaN(lry)) pages.set(n, [lrx, lry]);
  }

  const references: Reference[] = [];
  const byKey = new Set<string>();
  for (const bibl of descendants(root, "biblStruct")) {
    const key = bibl.attributes["xml:id"];
    if (!key) continue; // the header's own biblStruct, describing this paper
    references.push(referenceFrom(bibl, key, references.length, pages));
    byKey.add(key);
  }

  const markers = [...descendants(root, "ref")].filter((r) => r.attributes.type === "bibr");
  // A display equation is numbered at the right margin — "(7)" — and
  // GROBID reads that as a citation of reference 7. A paper cites one way
  // throughout: where its markers are mostly bracketed a bare "(7)" is
  // not one of them; where they are not, every marker is kept.
  const labels = markers.map((m) => (text(m) ?? ""));
  const equations = labels.filter((l) => EQUATION_NUMBER.test(l)).length;
  const bracketed = labels.filter((l) => l.includes("[") || l.includes("]")).length;
  const citesInBrackets = bracketed > equations;

  const citations: Citation[] = [];
  markers.forEach((marker, i) => {
    const label = labels[i];
    if (citesInBrackets && EQUATION_NUMBER.test(label)) return;
    let target: string | null = (marker.attributes.target ?? "").replace(/^#/, "");
    let inferred = false;
    if (!byKey.has(target)) {
      // GROBID marked a citation without deciding which work it cites. In
      // a numbered bibliography the marker says which entry: count.
      target = numberedTarget(label, references);
      inferred = target !== null;
    }
    if (!target) return; // nothing to open: not clickable
    for (const box of boxes(marker.attributes.coords, pages)) citations.push({ key: target, label, inferred, ...box });
  });

  // Figures, tables and boxes share TEI's `figure`, and GROBID can attach
  // an in-text Box reference to a Figure with the same number. Keep the
  // explicit target, but index the printed heading so the document's own
  // words can disambiguate.
  const figures = new Map<string, Box>();
  const namedTargets = new Map<string, Box>();
  for (const figure of descendants(root, "figure")) {
    const key = figure.attributes["xml:id"];
    const found = boxes(figure.attributes.coords, pages);
    if (!key || !found.length) continue;
    figures.set(key, found[0]);
    const heading = [children(figure, "head")[0], children(figure, "label")[0]].map(text).filter(Boolean).join(" ");
    const match = heading.match(TARGET_HEADING);
    if (match) namedTargets.set(`${linkKind(match[1])}\n${match[2].toLowerCase()}`, found[0]);
  }
  const prefixes = precedingText(root);
  const links: DocumentLink[] = [];
  for (const marker of descendants(root, "ref")) {
    if (marker.attributes.type !== "figure") continue;
    const label = text(marker) ?? "";
    const kindMatch = (prefixes.get(marker) ?? "").match(CROSS_REFERENCE_KIND);
    const kind = kindMatch ? linkKind(kindMatch[1]) : "figure";
    const target = namedTargets.get(`${kind}\n${label.toLowerCase()}`) ?? figures.get((marker.attributes.target ?? "").replace(/^#/, ""));
    if (!target) continue;
    for (const box of boxes(marker.attributes.coords, pages)) {
      // Extend left over the prefix so the whole phrase is one pointer
      // target rather than only the numeral.
      const [pageWidth, pageHeight] = pages.get(box.page)!;
      const prefix = Math.min(box.x, box.h * pageHeight / pageWidth * FIGURE_PREFIX_EMS);
      links.push({ kind, label, ...box, x: box.x - prefix, w: box.w + prefix, target_page: target.page, target_y: target.y });
    }
  }
  return { references, citations, links };
}
