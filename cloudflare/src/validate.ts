// What a row may say, held to once, wherever the row comes from.
//
// The website's forms and a replica's push arrive at the same rules, so a
// title the browser accepts is one the Mac can push back. The limits are
// config/app_limits.json, the same file the clients read. A refusal is a
// 422 with a sentence, or a list of them.

import limits from "../../config/app_limits.json";
import { refuse } from "./http";

export const text = limits.text;
export const board = limits.board;
export const counts = limits.counts;
export const ratings = limits.ratings;
export const publicationYear = limits.publication_year;
export const annotations = limits.annotations;

type Problem = string;

class Check {
  problems: Problem[] = [];

  fail(message: string) {
    this.problems.push(message);
  }

  string(field: string, value: unknown, { min = 0, max = Infinity, optional = false, pattern }: { min?: number; max?: number; optional?: boolean; pattern?: RegExp } = {}): string | null {
    if (value === null || value === undefined) {
      if (!optional) this.fail(`${field} is required`);
      return null;
    }
    if (typeof value !== "string") { this.fail(`${field} must be a string`); return null; }
    if (value.length < min) this.fail(min === 1 ? `${field} must not be empty` : `${field} must be at least ${min} characters`);
    if (value.length > max) this.fail(`${field} must be at most ${max} characters`);
    if (pattern && !pattern.test(value)) this.fail(`${field} is not in the expected form`);
    return value;
  }

  integer(field: string, value: unknown, { min = -Infinity, max = Infinity, optional = false }: { min?: number; max?: number; optional?: boolean } = {}): number | null {
    if (value === null || value === undefined) {
      if (!optional) this.fail(`${field} is required`);
      return null;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) { this.fail(`${field} must be an integer`); return null; }
    if (value < min || value > max) this.fail(`${field} must be between ${min} and ${max}`);
    return value;
  }

  number(field: string, value: unknown, { min = -Infinity, max = Infinity, exclusiveMin = false, optional = false }: { min?: number; max?: number; exclusiveMin?: boolean; optional?: boolean } = {}): number | null {
    if (value === null || value === undefined) {
      if (!optional) this.fail(`${field} is required`);
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) { this.fail(`${field} must be a number`); return null; }
    if (value < min || (exclusiveMin && value === min) || value > max) this.fail(`${field} must be between ${min} and ${max}`);
    return value;
  }

  boolean(field: string, value: unknown, { optional = false } = {}): boolean | null {
    if (value === null || value === undefined) {
      if (!optional) this.fail(`${field} is required`);
      return null;
    }
    if (typeof value !== "boolean" && value !== 0 && value !== 1) { this.fail(`${field} must be a boolean`); return null; }
    return Boolean(value);
  }

  oneOf<T extends string>(field: string, value: unknown, allowed: readonly T[], { optional = false } = {}): T | null {
    if (value === null || value === undefined) {
      if (!optional) this.fail(`${field} is required`);
      return null;
    }
    if (!allowed.includes(value as T)) { this.fail(`${field} must be one of ${allowed.join(", ")}`); return null; }
    return value as T;
  }

  done(): void {
    if (this.problems.length) refuse(422, this.problems.length === 1 ? this.problems[0] : this.problems);
  }
}

export function checking(): Check {
  return new Check();
}

// ---------------------------------------------------------------- papers

const DOI_URL = /^\s*(?:https?:\/\/)?(?:dx\.)?doi\.org\//i;

// A DOI as it is stored: the identifier alone, never the resolver's URL.
export function bareDoi(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const bare = String(value).replace(DOI_URL, "").trim();
  return bare || null;
}

// A paper's title is the one thing it must have: a paper with no title is
// a row nobody can find again. Trimmed here, once, so an upload, an edit
// and a replica's push agree on what a title is.
export function paperMetadata(row: { doi?: unknown; title?: unknown; authors?: unknown; journal?: unknown; year?: unknown }) {
  const check = checking();
  const doi = check.string("doi", bareDoi(row.doi), { max: text.paper_doi, optional: true });
  const title = check.string("title", typeof row.title === "string" ? row.title.trim() : row.title, { min: 1, max: text.paper_title });
  const authors = check.string("authors", row.authors, { max: text.paper_authors, optional: true });
  const journal = check.string("journal", row.journal, { max: text.paper_journal, optional: true });
  const year = check.integer("year", row.year, { min: publicationYear.min, max: publicationYear.max, optional: true });
  check.done();
  return { doi, title: title!, authors, journal, year };
}

// The personal fields of a copy, as the website's edit form holds them.
export function copyFields(values: Record<string, unknown>) {
  const check = checking();
  for (const field of ["rating_expertise", "rating_reading", "rating_liking"]) {
    if (field in values) check.integer(field, values[field], { min: ratings.min, max: ratings.max, optional: true });
  }
  if ("thought" in values) check.string("thought", values.thought, { max: text.paper_thought, optional: true });
  if ("summary" in values) check.string("summary", values.summary, { optional: true });
  check.done();
}

// ---------------------------------------------------------- shelves, tags

export const COLOR = /^#[0-9a-fA-F]{6}$/;

export function shelf(row: { name?: unknown; color?: unknown }) {
  const check = checking();
  check.string("name", row.name, { min: 1, max: text.shelf_name });
  check.string("color", row.color, { pattern: COLOR });
  check.done();
}

export function tag(row: { name?: unknown }) {
  const check = checking();
  check.string("name", row.name, { min: 1, max: text.tag_name });
  check.done();
}

// ---------------------------------------------------------------- boards

export const BOARD_GROUP_KINDS = ["booklet", "collection"] as const;
export const BOARD_ITEM_KINDS = ["comment", "excerpt", "image", "file", "youtube", "bilibili", "webpage"] as const;
export const TEXT_ALIGNS = ["left", "center", "right"] as const;

export function boardName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > text.board_name) refuse(422, "Board name must be 1–120 characters");
  return trimmed;
}

export function boardGroup(row: { kind?: unknown; title?: unknown; header?: unknown }) {
  const check = checking();
  check.oneOf("kind", row.kind, BOARD_GROUP_KINDS);
  check.string("title", row.title, { max: text.board_group_title, optional: true });
  check.string("header", row.header, { max: text.board_group_header, optional: true });
  check.done();
}

export function boardItem(row: { kind?: unknown; width?: unknown; text_align?: unknown; position?: unknown; content?: unknown; x?: unknown; y?: unknown }) {
  const check = checking();
  check.oneOf("kind", row.kind, BOARD_ITEM_KINDS);
  check.number("width", row.width, { min: board.item_width_min, max: board.item_width_max, optional: true });
  check.oneOf("text_align", row.text_align, TEXT_ALIGNS, { optional: true });
  check.integer("position", row.position, { min: 0, max: board.position_max, optional: true });
  check.string("content", row.content, { max: text.board_content, optional: true });
  check.number("x", row.x, { min: -board.coordinate_abs_max, max: board.coordinate_abs_max, optional: true });
  check.number("y", row.y, { min: -board.coordinate_abs_max, max: board.coordinate_abs_max, optional: true });
  check.done();
}

// A link a card may carry: a page in a browser, never a script or a
// credential.
export function boardLink(value: unknown): string {
  let parsed: URL | null = null;
  try { parsed = typeof value === "string" ? new URL(value) : null; } catch { parsed = null; }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    refuse(422, "Board links must use http or https");
  }
  return value as string;
}

// ----------------------------------------------------------- annotations

export const ANNOTATION_KINDS = ["note", "ink", "clip"] as const;

function fraction(check: Check, field: string, value: unknown, { exclusiveMin = false } = {}) {
  return check.number(field, value, { min: 0, max: 1, exclusiveMin });
}

// `kind` decides which body is required, and which of the shared fields
// mean anything: ink and clips are always on a page of a PDF, while a note
// may be about the paper and placed nowhere.
export function annotation(row: { kind?: unknown; page?: unknown; group_uuid?: unknown; content?: unknown; name?: unknown; body?: unknown }) {
  const check = checking();
  const kind = check.oneOf("kind", row.kind, ANNOTATION_KINDS);
  const page = check.integer("page", row.page, { min: 1, optional: true });
  check.string("group_uuid", row.group_uuid, { max: 36, optional: true });
  const content = check.string("content", row.content ?? "", { max: text.comment }) ?? "";
  check.string("name", row.name, { max: text.annotation_name, optional: true });
  let body: Record<string, unknown> = {};
  if (typeof row.body === "string") {
    try { body = JSON.parse(row.body || "{}"); } catch { check.fail("body is not JSON"); }
  } else if (row.body && typeof row.body === "object") {
    body = row.body as Record<string, unknown>;
  }
  if (kind === "note") {
    const anchor = body.anchor as Record<string, unknown> | null | undefined;
    if (anchor != null) {
      if (anchor.type !== undefined && anchor.type !== "point") check.fail("anchor.type must be point");
      fraction(check, "anchor.x", anchor.x);
      fraction(check, "anchor.y", anchor.y);
    }
    // A bare anchor is allowed: the user anchors a place first and writes
    // about it later. A note with no place must say something.
    if ((page === null) !== (anchor == null)) check.fail("a located note needs both a page and an anchor");
    if (anchor == null && !content.trim()) check.fail("a note with no place needs something written in it");
  } else if (kind === "ink") {
    if (page === null) check.fail("an ink belongs on a page");
    const points = body.points;
    if (!Array.isArray(points) || points.length < 1 || points.length > counts.ink_points) {
      check.fail(`points must hold between 1 and ${counts.ink_points} points`);
    } else {
      for (const point of points as Record<string, unknown>[]) {
        fraction(check, "points.x", point?.x);
        fraction(check, "points.y", point?.y);
      }
    }
    check.string("color", body.color ?? "#b3923d", { pattern: COLOR });
    check.number("width", body.width ?? 0.004, { min: 0, max: annotations.ink_width_max, exclusiveMin: true });
    check.number("opacity", body.opacity ?? 1, { min: 0, max: 1, exclusiveMin: true });
    check.oneOf("shape", body.shape ?? "flat", ["flat", "round"] as const);
  } else if (kind === "clip") {
    if (page === null) check.fail("a clip belongs on a page");
    const source = (body.source ?? {}) as Record<string, unknown>;
    const sx = fraction(check, "source.x", source.x), sy = fraction(check, "source.y", source.y);
    const sw = fraction(check, "source.w", source.w, { exclusiveMin: true }), sh = fraction(check, "source.h", source.h, { exclusiveMin: true });
    if (sx !== null && sw !== null && sy !== null && sh !== null && (sx + sw > 1.000001 || sy + sh > 1.000001)) {
      check.fail("rectangle must stay on its page");
    }
    const frame = (body.frame ?? {}) as Record<string, unknown>;
    const reach = annotations.clip_frame_coordinate_abs_max;
    check.number("frame.x", frame.x, { min: -reach, max: reach });
    check.number("frame.y", frame.y, { min: -reach, max: reach });
    check.number("frame.w", frame.w, { min: 0, max: annotations.clip_frame_size_max, exclusiveMin: true });
    check.number("frame.h", frame.h, { min: 0, max: annotations.clip_frame_size_max, exclusiveMin: true });
    if (frame.floating !== undefined) check.boolean("frame.floating", frame.floating);
  }
  check.done();
}

// The body as it is stored by a route: one kind's geometry with its
// defaults filled in, so a stroke drawn without saying its colour has one
// on every device. Asked only of a body `annotation()` has passed.
export function normalizedBody(kind: string, body: Record<string, unknown>): Record<string, unknown> {
  if (kind === "note") {
    const anchor = body.anchor as Record<string, unknown> | null | undefined;
    return anchor == null ? {} : { anchor: { type: "point", x: anchor.x, y: anchor.y } };
  }
  if (kind === "ink") {
    return {
      points: (body.points as Record<string, unknown>[]).map((p) => ({ x: p.x, y: p.y })),
      color: body.color ?? "#b3923d", width: body.width ?? 0.004, opacity: body.opacity ?? 1, shape: body.shape ?? "flat",
    };
  }
  const source = body.source as Record<string, unknown>, frame = body.frame as Record<string, unknown>;
  return {
    source: { x: source.x, y: source.y, w: source.w, h: source.h },
    frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
    floating: Boolean(body.floating ?? false),
  };
}

// ------------------------------------------------------------------ users

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function registration(row: { email?: unknown; display_name?: unknown; affiliation?: unknown; password?: unknown }) {
  const check = checking();
  const email = check.string("email", row.email, { max: text.email, pattern: EMAIL });
  const displayName = check.string("display_name", row.display_name, { min: 1, max: text.display_name });
  const affiliation = check.string("affiliation", row.affiliation, { max: text.affiliation, optional: true });
  const password = check.string("password", row.password, { min: 6, max: text.password });
  check.done();
  return { email: email!, display_name: displayName!, affiliation, password: password! };
}
