// A replica's changes, applied once and answered the same way every time.
//
// The desktop keeps an outbox of mutations and pushes them one at a time.
// Each carries the client's own UUID and the mutation's, so a reply lost
// on the way is asked for again by the same name and answered from the
// stored copy — never applied twice. Within one mutation the changes are
// ordered: a board before its cards, a copy before the tag on it. A row a
// later change refers to may have been made by an earlier change in the
// same push, so the rows are worked on in memory and written at the end,
// as one batch: the rows, the change log, and the stored reply, or none.
//
// That is also the whole of the concurrency story on D1, which has no
// interactive transactions. Reads come first, the decision is made in
// code, and the batch is atomic. Two replicas of one account pushing at
// the same instant could interleave a read and a write; the revision
// each carries reports that as a conflict on the next push, and the
// snapshot every reconciliation fetches first settles it.

import { currentUser, type User } from "../auth";
import { inActiveCohort } from "../cohorts";
import { all, batch, insert, newUuid, now, one, update, type Row } from "../db";
import { json, readJson, refuse, type RouteContext } from "../http";
import * as validate from "../validate";
import { requireSupportedClient } from "./client";
import { blobKey, boardFileKey, paperKey, stored } from "../files";
import { keyColumn, ownedThroughBoard, registry, rule, writable, WRITE_ORDER } from "./registry";
import { rowSnapshot } from "./rows";
import { writePaper, writeSynced } from "./write";
import limits from "../../../config/app_limits.json";

// ------------------------------------------------------------ the request

interface RowChange {
  table: string;
  uuid: string;
  base_revision: number | null;
  operation: "upsert" | "delete";
  values: Record<string, unknown>;
}

interface PushRequest {
  client_uuid: string;
  mutation_uuid: string;
  local_sequence: number;
  changes: RowChange[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;

function parsePush(body: unknown): PushRequest {
  const check = validate.checking();
  const raw = (body ?? {}) as Record<string, unknown>;
  const clientUuid = check.string("client_uuid", raw.client_uuid, { pattern: UUID });
  const mutationUuid = check.string("mutation_uuid", raw.mutation_uuid, { pattern: UUID });
  const localSequence = check.integer("local_sequence", raw.local_sequence, { min: 0 });
  const changes: RowChange[] = [];
  if (!Array.isArray(raw.changes) || raw.changes.length < 1 || raw.changes.length > limits.counts.sync_push_changes) {
    check.fail(`changes must hold between 1 and ${limits.counts.sync_push_changes} changes`);
  } else {
    raw.changes.forEach((item, index) => {
      const change = (item ?? {}) as Record<string, unknown>;
      const table = typeof change.table === "string" ? change.table : "";
      if (!(table in registry.tables)) { check.fail(`changes[${index}]: ${table || "?"} is not a table a client writes`); return; }
      const uuid = typeof change.uuid === "string" ? change.uuid : "";
      // A UUID for everything a client makes up, and for a paper the digest
      // of its PDF — which is not made up at all: both ends read it off the
      // same bytes and arrive at the same name.
      if (table === "papers" ? !DIGEST.test(uuid) : !UUID.test(uuid)) {
        check.fail(table === "papers" ? "a paper is named by the sha256 of its PDF" : `${table} rows are named by UUID`);
        return;
      }
      const baseRevision = change.base_revision === undefined || change.base_revision === null
        ? null : check.integer(`changes[${index}].base_revision`, change.base_revision, { min: 0 });
      const operation = check.oneOf(`changes[${index}].operation`, change.operation, ["upsert", "delete"] as const);
      const values = change.values === undefined ? {} : change.values;
      if (!values || typeof values !== "object" || Array.isArray(values)) { check.fail(`changes[${index}].values must be an object`); return; }
      if (operation) changes.push({ table, uuid: table === "papers" ? uuid : uuid.toLowerCase(), base_revision: baseRevision, operation, values: values as Record<string, unknown> });
    });
  }
  check.done();
  return { client_uuid: clientUuid!.toLowerCase(), mutation_uuid: mutationUuid!.toLowerCase(), local_sequence: localSequence!, changes };
}

// One string for one logical request, whatever key order or whitespace
// the client used: what the stored reply is compared against.
function canonical(payload: PushRequest): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value as Row).sort().map((k) => [k, sort((value as Row)[k])]));
    }
    return value;
  };
  return JSON.stringify(sort(payload));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------- the working set

interface Entry {
  table: string;
  row: Row;
  isNew: boolean;
  modified: boolean;
  // A paper this user imported in this push, or holds already and asked
  // for again: visible to them whatever their copies say.
  importedBy?: string;
}

class Working {
  private entries = new Map<string, Entry | null>();
  readonly touched: Entry[] = [];

  constructor(readonly db: D1Database, readonly user: User) {}

  private key(table: string, uuid: string) {
    return `${table}\0${uuid}`;
  }

  // The row as it stands in this push: loaded once, then whatever earlier
  // changes made of it.
  async load(table: string, uuid: string | null | undefined): Promise<Entry | null> {
    if (typeof uuid !== "string" || !uuid) return null;
    const key = this.key(table, uuid);
    if (this.entries.has(key)) return this.entries.get(key)!;
    const row = await one(this.db, `SELECT * FROM ${table} WHERE ${keyColumn(table)} = ?`, uuid);
    const entry = row ? { table, row, isNew: false, modified: false } : null;
    this.entries.set(key, entry);
    return entry;
  }

  create(table: string, row: Row): Entry {
    const entry: Entry = { table, row, isNew: true, modified: true };
    this.entries.set(this.key(table, String(row[keyColumn(table)])), entry);
    return entry;
  }

  // Rows of a table with a column equal to a value, as they stand here:
  // what the database holds, less what this push has changed, plus what
  // it has made.
  async where(table: string, column: string, value: unknown): Promise<Entry[]> {
    const rows = await all(this.db, `SELECT * FROM ${table} WHERE ${column} = ?`, value);
    const found: Entry[] = [];
    for (const row of rows) {
      const entry = await this.load(table, String(row[keyColumn(table)]));
      if (entry) found.push(entry);
    }
    for (const entry of this.entries.values()) {
      if (entry?.isNew && entry.table === table && entry.row[column] === value && !found.includes(entry)) found.push(entry);
    }
    return found;
  }

  all(): Entry[] {
    return [...this.entries.values()].filter((entry): entry is Entry => entry !== null);
  }

  // The row, if it is this user's to change. A paper is nobody's; a card
  // or a group is its board's user's; everything else names its user.
  async owned(table: string, uuid: string): Promise<Entry | null> {
    const entry = await this.load(table, uuid);
    if (!entry) return null;
    if (table === "papers") return entry;
    if (ownedThroughBoard(table)) {
      const board = await this.load("boards", entry.row.board_uuid as string);
      return board?.row.user_uuid === this.user.uuid ? entry : null;
    }
    return entry.row.user_uuid === this.user.uuid ? entry : null;
  }
}

// ----------------------------------------------------- what a row may name

async function ownedShelf(work: Working, shelfUuid: unknown): Promise<Entry | null> {
  if (shelfUuid === null || shelfUuid === undefined) return null;
  const shelf = await work.load("shelves", shelfUuid as string);
  if (!shelf || shelf.row.user_uuid !== work.user.uuid || shelf.row.deleted_at) refuse(409, "Referenced shelf is unavailable");
  return shelf;
}

async function ownedRow(work: Working, table: string, uuid: unknown, what: string): Promise<Entry> {
  const entry = typeof uuid === "string" ? await work.owned(table, uuid) : null;
  if (!entry || entry.row.deleted_at) refuse(409, `Referenced ${what} is unavailable`);
  return entry;
}

async function ownedBoard(work: Working, boardUuid: unknown): Promise<Entry> {
  const board = typeof boardUuid === "string" ? await work.load("boards", boardUuid) : null;
  if (!board || board.row.user_uuid !== work.user.uuid || board.row.deleted_at) refuse(409, "Referenced board is unavailable");
  return board;
}

async function ownedGroup(work: Working, groupUuid: unknown, board: Entry): Promise<Entry | null> {
  if (groupUuid === null || groupUuid === undefined) return null;
  const group = await work.load("board_groups", groupUuid as string);
  if (!group || group.row.board_uuid !== board.row.uuid || group.row.deleted_at) refuse(409, "Referenced group is unavailable");
  return group;
}

// A paper the user may keep a copy of: one they imported here, or one
// somebody keeps on a public shelf, or one they already keep themselves.
async function visiblePaper(work: Working, paperSha256: unknown): Promise<Entry> {
  const paper = typeof paperSha256 === "string" ? await work.load("papers", paperSha256) : null;
  if (!paper || paper.row.deleted_at) refuse(409, "Referenced paper is unavailable");
  if (paper.isNew || paper.importedBy === work.user.uuid) return paper;
  const visible = await one(
    work.db,
    `SELECT 1 FROM copies c LEFT JOIN shelves s ON s.uuid = c.shelf_uuid
     WHERE c.paper_sha256 = ? AND c.deleted_at IS NULL AND (c.user_uuid = ? OR s.is_public = 1) LIMIT 1`,
    paper.row.sha256, work.user.uuid,
  );
  if (!visible) refuse(409, "Referenced paper is unavailable");
  return paper;
}

// A paper the user keeps: what an annotation may be about.
async function keptPaper(work: Working, paperSha256: unknown): Promise<Entry> {
  const paper = typeof paperSha256 === "string" ? await work.load("papers", paperSha256) : null;
  const kept = paper && (
    paper.importedBy === work.user.uuid
    || (await work.where("copies", "paper_sha256", paper.row.sha256)).some((copy) => copy.row.user_uuid === work.user.uuid)
  );
  if (!paper || !kept) refuse(409, "Referenced paper is unavailable");
  return paper;
}

// ---------------------------------------------------------- a fresh row

async function newRecord(work: Working, env: Env, change: RowChange): Promise<Entry> {
  const { table, uuid, values } = change;
  const at = now();
  const bookkeeping = { created_at: at, updated_at: at, revision: 0, deleted_at: null };
  const user = work.user.uuid;
  switch (table) {
    case "papers":
      // The row's name is the digest, so the bytes it names have to be
      // in the bucket, under the paper's key, before the row is: a paper
      // Papol cannot open is not one it can store.
      if (!(await stored(env, paperKey(uuid)))) refuse(409, "Paper PDF has not been uploaded");
      return work.create(table, { sha256: uuid, doi: null, title: "", authors: null, journal: null, year: null,
        file_path: `${uuid}.pdf`, uploaded_by: user, ...bookkeeping, revision: 1 });
    case "boards": {
      const shelf = await ownedShelf(work, values.shelf_uuid);
      return work.create(table, { uuid, user_uuid: user, shelf_uuid: shelf?.row.uuid ?? null, name: "", description: null, ...bookkeeping });
    }
    case "annotations": {
      if (typeof values.paper_sha256 !== "string") refuse(422, "annotations.paper_sha256 is required");
      const paper = await keptPaper(work, values.paper_sha256);
      return work.create(table, { uuid, kind: values.kind ?? null, user_uuid: user, paper_sha256: paper.row.sha256,
        page: null, group_uuid: null, content: "", name: null, body: "{}", ...bookkeeping });
    }
    case "shelves":
      return work.create(table, { uuid, user_uuid: user, name: "", color: "#7f8c8d", is_public: 0, is_default: 0, position: 0, ...bookkeeping });
    case "tags":
      return work.create(table, { uuid, user_uuid: user, name: "", ...bookkeeping });
    case "copies": {
      if (typeof values.paper_sha256 !== "string") refuse(422, "copies.paper_sha256 is required");
      const paper = await visiblePaper(work, values.paper_sha256);
      const shelf = await ownedShelf(work, values.shelf_uuid);
      return work.create(table, { uuid, paper_sha256: paper.row.sha256, user_uuid: user, shelf_uuid: shelf?.row.uuid ?? null,
        summary: null, thought: null, is_author: 0, rating_expertise: null, rating_reading: null, rating_liking: null, ...bookkeeping });
    }
    case "copy_tags": {
      if (typeof values.copy_uuid !== "string" || typeof values.tag_uuid !== "string") refuse(422, "copy_tags needs copy_uuid and tag_uuid");
      const copy = await ownedRow(work, "copies", values.copy_uuid, "copy");
      const tag = await ownedRow(work, "tags", values.tag_uuid, "tag");
      return work.create(table, { uuid, copy_uuid: copy.row.uuid, tag_uuid: tag.row.uuid, user_uuid: user, ...bookkeeping });
    }
    default: {
      if (typeof values.board_uuid !== "string") refuse(422, `${table}.board_uuid is required`);
      const board = await ownedBoard(work, values.board_uuid);
      if (table === "board_groups") {
        return work.create(table, { uuid, board_uuid: board.row.uuid, kind: "booklet", title: "", header: null, auto_arrange: 0, ...bookkeeping });
      }
      const group = await ownedGroup(work, values.group_uuid, board);
      return work.create(table, { uuid, board_uuid: board.row.uuid, group_uuid: group?.row.uuid ?? null, kind: "comment",
        content: null, excerpt_text: null, file_path: null, sha256: null, original_filename: null, mime_type: null,
        source_url: null, source_label: null, staged: 0, text_align: "left", position: 0, x: 0, y: 0, width: 300, ...bookkeeping });
    }
  }
}

// ------------------------------------------------------ what a row becomes

function setAll(row: Row, values: Record<string, unknown>, except: Set<string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!except.has(key)) row[key] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }
}

async function assignValues(work: Working, env: Env, entry: Entry, values: Record<string, unknown>) {
  const { table, row } = entry;
  const user = work.user;
  switch (table) {
    case "papers": {
      // The PDF is the paper's identity: metadata may be corrected, but
      // different bytes are a different paper, not an edit to this one.
      if ("sha256" in values && values.sha256 !== row.sha256) refuse(422, "Paper content cannot change");
      setAll(row, values, new Set(["deleted_at", "sha256", "file_path"]));
      row.title = String(row.title ?? "").trim();
      // Held to the one shape its record may take, asked of the row after
      // the change: a push may name one field, and what has to be true is
      // true of the row.
      Object.assign(row, validate.paperMetadata(row));
      return;
    }
    case "boards": {
      if ("shelf_uuid" in values) row.shelf_uuid = (await ownedShelf(work, values.shelf_uuid))?.row.uuid ?? null;
      setAll(row, values, new Set(["shelf_uuid", "deleted_at"]));
      row.name = validate.boardName(row.name);
      return;
    }
    case "annotations": {
      if ("paper_sha256" in values) row.paper_sha256 = (await keptPaper(work, values.paper_sha256)).row.sha256;
      setAll(row, values, new Set(["paper_sha256", "deleted_at"]));
      // The client decides which kind of annotation it made; every kind is
      // then held to its own shape, so a replica cannot write a stroke with
      // no points or an anchor off the page.
      validate.annotation(row);
      return;
    }
    case "shelves":
      setAll(row, values, new Set(["deleted_at"]));
      row.name = String(row.name ?? "").trim();
      validate.shelf(row);
      return;
    case "tags":
      setAll(row, values, new Set(["deleted_at"]));
      row.name = String(row.name ?? "").trim();
      validate.tag(row);
      return;
    case "copies": {
      if ("paper_sha256" in values) row.paper_sha256 = (await visiblePaper(work, values.paper_sha256)).row.sha256;
      if ("shelf_uuid" in values) {
        const shelf = await ownedShelf(work, values.shelf_uuid);
        // Visibility belongs to the shelf, so the move is the whole of it.
        // A paper still being discussed in a seminar stays on display.
        if (shelf && !shelf.row.is_public) {
          const current = row.shelf_uuid ? await work.load("shelves", row.shelf_uuid as string) : null;
          if (current?.row.is_public && await inActiveCohort(work.db, user.uuid, row.paper_sha256 as string)) {
            refuse(422, "Leave the seminar before moving this paper to a private shelf");
          }
        }
        row.shelf_uuid = shelf?.row.uuid ?? null;
      }
      setAll(row, values, new Set(["paper_sha256", "shelf_uuid", "deleted_at"]));
      validate.copyFields(values);
      return;
    }
    case "copy_tags":
      if ("copy_uuid" in values) row.copy_uuid = (await ownedRow(work, "copies", values.copy_uuid, "copy")).row.uuid;
      if ("tag_uuid" in values) row.tag_uuid = (await ownedRow(work, "tags", values.tag_uuid, "tag")).row.uuid;
      return;
  }
  // A card or a group.
  if ("board_uuid" in values) row.board_uuid = (await ownedBoard(work, values.board_uuid)).row.uuid;
  if (table === "board_items") {
    if ("group_uuid" in values) {
      const board = await ownedBoard(work, row.board_uuid);
      row.group_uuid = (await ownedGroup(work, values.group_uuid, board))?.row.uuid ?? null;
    }
    if (values.sha256) {
      const digest = String(values.sha256);
      if (!DIGEST.test(digest) || !(await stored(env, boardFileKey(blobKey(digest))))) refuse(409, "Referenced blob has not been uploaded");
      row.file_path = blobKey(digest);
    }
    if (values.source_url) validate.boardLink(values.source_url);
  }
  setAll(row, values, new Set(["board_uuid", "group_uuid", "deleted_at"]));
  if (table === "board_groups") validate.boardGroup(row);
  else validate.boardItem(row);
}

// ---------------------------------------------------------- one change

interface Conflict {
  table: string;
  uuid: string;
  resolution: "client_won" | "server_won";
  server_revision: unknown;
  reason?: string;
  previous?: Row;
  rejected_values?: Record<string, unknown>;
}

async function applyChange(work: Working, env: Env, change: RowChange): Promise<{ record: Entry | null; conflict: Conflict | null }> {
  const { table, uuid } = change;
  const allowed = writable(table);
  const unknown = Object.keys(change.values).filter((key) => !allowed.has(key));
  if (unknown.length) refuse(422, `Client cannot write ${table}: ${unknown.sort().join(", ")}`);

  let record = await work.owned(table, uuid);
  if (rule(table).create_only && record) refuse(409, `${table} rows are create-only`);
  if (!record) {
    // Somebody else's row, or one this user may not touch.
    if (await work.load(table, uuid)) refuse(404, "Synchronized row not found");
    // A delete says what the final state should be. If a restored or
    // replaced server database has already lost that row, the requested
    // state is satisfied and the mutation can be acknowledged.
    if (change.operation === "delete") return { record: null, conflict: null };
    record = await newRecord(work, env, change);
  }

  // A tombstone is an intentional deletion, not an empty row waiting for a
  // stale client to bring it back. The attempted values go in the conflict
  // so the user's work remains recoverable; the delete wins on every device.
  if (record.row.deleted_at && change.operation !== "delete") {
    return { record, conflict: {
      table, uuid, resolution: "server_won", reason: "row_deleted",
      server_revision: record.row.revision, rejected_values: change.values,
    } };
  }

  let conflict: Conflict | null = null;
  if (change.base_revision !== null && record.row.revision !== change.base_revision) {
    const before = await rowSnapshot(work.db, table, record.row);
    conflict = {
      table, uuid, resolution: "client_won", server_revision: record.row.revision,
      previous: Object.fromEntries(Object.keys(change.values).map((key) => [key, before[key] ?? null])),
    };
  }

  if (change.operation === "delete") {
    const at = now();
    record.row.deleted_at = at;
    record.modified = true;
    if (table === "boards") {
      for (const child of [...await work.where("board_groups", "board_uuid", uuid), ...await work.where("board_items", "board_uuid", uuid)]) {
        child.row.deleted_at = at;
        child.modified = true;
      }
    } else if (table === "board_groups") {
      for (const item of await work.where("board_items", "group_uuid", uuid)) {
        item.row.group_uuid = null;
        item.modified = true;
      }
    } else if (table === "shelves") {
      // Its contents, all of them: a shelf holds boards as well as papers.
      // The website moves both onto another shelf; here the answer is the
      // message's own: move them first.
      const emptied = (await work.where("copies", "shelf_uuid", uuid)).every((c) => c.row.deleted_at)
        && (await work.where("boards", "shelf_uuid", uuid)).every((b) => b.row.deleted_at);
      if (record.row.is_default || !emptied) refuse(409, "Move shelf contents before deleting it");
    }
  } else {
    await assignValues(work, env, record, change.values);
    record.row.deleted_at = null;
    record.modified = true;
  }
  if (table === "board_groups" || table === "board_items") {
    // The board's own clock, so the website lists it as lately worked on.
    // Not a revision: nothing a replica may write on the board changed.
    const board = await work.load("boards", record.row.board_uuid as string);
    if (board) board.row.updated_at = now();
  }
  return { record, conflict };
}

function validateImportBatch(changes: RowChange[]) {
  const papers = new Set(changes.filter((c) => c.table === "papers").map((c) => c.uuid));
  if (!papers.size) return;
  if (changes.some((c) => c.table === "papers" && (c.operation !== "upsert" || (c.base_revision !== null && c.base_revision !== 0)))) {
    refuse(422, "Paper imports are create-only");
  }
  for (const digest of papers) {
    if (!changes.some((c) => c.table === "copies" && c.values.paper_sha256 === digest)) {
      refuse(422, "Paper import needs an owned copy");
    }
  }
}

// ------------------------------------------------------------- the route

export async function push({ request, env }: RouteContext): Promise<Response> {
  requireSupportedClient(request);
  const user = await currentUser(request, env);
  const payload = parsePush(await readJson(request));
  const fingerprint = await sha256Hex(canonical(payload));

  const existing = await one<{ request_hash: string; response_json: string }>(
    env.DB,
    "SELECT request_hash, response_json FROM applied_mutations WHERE user_uuid = ? AND client_uuid = ? AND mutation_uuid = ?",
    user.uuid, payload.client_uuid, payload.mutation_uuid,
  );
  if (existing) {
    if (existing.request_hash !== fingerprint) refuse(409, "Mutation UUID has different content");
    return new Response(existing.response_json, { headers: { "content-type": "application/json" } });
  }

  validateImportBatch(payload.changes);
  const work = new Working(env.DB, user);
  const conflicts: Conflict[] = [];
  const aliases: Record<string, string> = {};

  for (const original of payload.changes) {
    const change: RowChange = {
      ...original,
      values: Object.fromEntries(Object.entries(original.values).map(([k, v]) => [k, typeof v === "string" ? aliases[v] ?? v : v])),
    };
    if (change.table === "papers") {
      // No alias: the replica named this paper by its digest, and so would
      // we. When Papol already holds the file, the import is simply the
      // user saying they have it too.
      const held = await work.load("papers", change.uuid);
      if (held) {
        held.importedBy = user.uuid;
        if (!(await stored(env, paperKey(change.uuid)))) refuse(409, "Paper PDF has not been uploaded");
        work.touched.push(held);
        continue;
      }
    }
    if (change.table === "copies" && (change.base_revision === null || change.base_revision === 0)) {
      const paper = await visiblePaper(work, change.values.paper_sha256);
      const owned = (await work.where("copies", "paper_sha256", paper.row.sha256)).filter((c) => c.row.user_uuid === user.uuid);
      const canonical = owned.find((c) => !c.row.deleted_at) ?? owned[0];
      if (canonical && canonical.row.uuid !== change.uuid) {
        aliases[change.uuid] = canonical.row.uuid as string;
        change.uuid = canonical.row.uuid as string;
      }
      // A user has one copy per paper, so adding back a paper they once
      // removed revives that tombstone rather than inserting a second row.
      // Only a fresh addition may do this: a stale edit still loses to the
      // delete.
      if (canonical?.row.deleted_at) {
        canonical.row.deleted_at = null;
        canonical.modified = true;
      }
    }
    if (change.table === "copy_tags" && (change.base_revision === null || change.base_revision === 0)) {
      const copy = await ownedRow(work, "copies", change.values.copy_uuid, "copy");
      const tag = await ownedRow(work, "tags", change.values.tag_uuid, "tag");
      const canonical = (await work.where("copy_tags", "copy_uuid", copy.row.uuid))
        .find((link) => link.row.tag_uuid === tag.row.uuid && link.row.user_uuid === user.uuid);
      if (canonical && canonical.row.uuid !== change.uuid) {
        aliases[change.uuid] = canonical.row.uuid as string;
        change.uuid = canonical.row.uuid as string;
      }
    }
    const { record, conflict } = await applyChange(work, env, change);
    if (record && !work.touched.includes(record)) work.touched.push(record);
    if (conflict) conflicts.push(conflict);
  }

  // Everything this push changed is versioned, written, and logged for
  // the replicas — in an order a parent precedes its children in.
  const at = now();
  const changed = work.all().filter((entry) => entry.modified || (entry.table === "papers" && work.touched.includes(entry)));
  const order = new Map<string, number>(WRITE_ORDER.map((table, index) => [table, index]));
  changed.sort((a, b) => (order.get(a.table) ?? 99) - (order.get(b.table) ?? 99));
  const statements: D1PreparedStatement[] = [];
  for (const entry of changed) {
    if (entry.table === "papers") {
      statements.push(await writePaper(env.DB, entry.row, entry.isNew));
      continue;
    }
    const owner = ownedThroughBoard(entry.table)
      ? (await work.load("boards", entry.row.board_uuid as string))?.row.user_uuid as string
      : entry.row.user_uuid as string;
    statements.push(...await writeSynced(env.DB, entry.table, entry.row, owner, entry.isNew));
  }
  // A board's clock moved by a card; not a version of the board.
  for (const entry of work.all()) {
    if (entry.table === "boards" && !changed.includes(entry) && !entry.isNew && entry.row.updated_at !== undefined) {
      statements.push(update(env.DB, "boards", "uuid", entry.row.uuid, { updated_at: entry.row.updated_at }));
    }
  }

  const rows: Row[] = [];
  for (const entry of work.touched) rows.push({ ...(await rowSnapshot(env.DB, entry.table, entry.row)), table: entry.table });
  const result = { mutation_uuid: payload.mutation_uuid, local_sequence: payload.local_sequence, rows, conflicts, aliases };
  const body = JSON.stringify(result);
  statements.push(insert(env.DB, "applied_mutations", {
    uuid: newUuid(), user_uuid: user.uuid, client_uuid: payload.client_uuid, mutation_uuid: payload.mutation_uuid,
    request_hash: fingerprint, response_json: body, created_at: at,
  }));

  try {
    await batch(env.DB, statements);
  } catch (error) {
    // The same mutation arriving twice at once: one of them stored its
    // reply first, and that reply is this one's answer too.
    const winner = await one<{ request_hash: string; response_json: string }>(
      env.DB,
      "SELECT request_hash, response_json FROM applied_mutations WHERE user_uuid = ? AND client_uuid = ? AND mutation_uuid = ?",
      user.uuid, payload.client_uuid, payload.mutation_uuid,
    );
    if (winner?.request_hash === fingerprint) return new Response(winner.response_json, { headers: { "content-type": "application/json" } });
    throw error;
  }
  return new Response(body, { headers: { "content-type": "application/json" } });
}

