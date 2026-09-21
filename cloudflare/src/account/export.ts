// Taking your things with you. A user who cannot leave with their notes
// does not really own them, so everything Papol holds about a user comes
// out as one zip: the data as JSON, the notes again as Markdown for a
// person rather than a parser, and the PDFs named after the papers.
//
// Streamed rather than built: a nook of a hundred papers is a few hundred
// megabytes of PDF, and the Worker holds one chunk of it at a time,
// waiting on the client between chunks.

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

import { type User } from "../auth";
import { all, type Row } from "../db";
import { BOARD_FILES, UPLOADS } from "../sync/blobs";

function authorsOf(paper: Row): unknown[] {
  try { return paper.authors ? JSON.parse(paper.authors as string) : []; } catch { return [paper.authors]; }
}

function paperRef(paper: Row) {
  return { uuid: paper.sha256, title: paper.title, authors: authorsOf(paper), journal: paper.journal, year: paper.year, doi: paper.doi };
}

function bodyOf(row: Row): Record<string, unknown> {
  try { return JSON.parse((row.body as string) || "{}"); } catch { return {}; }
}

// A filename a person would recognise, out of a paper's title.
export function slug(text: string, limit = 60): string {
  const plain = (text || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  return plain.slice(0, limit).replace(/^-+|-+$/g, "") || "paper";
}

// Everything Papol holds about this user, as plain data. What they have
// let go of — a removed copy, a deleted note, a deleted board — is not
// theirs any more and is not here.
export async function gather(db: D1Database, user: User) {
  const copies = await all<Row>(db, `SELECT c.*, p.sha256, p.title, p.authors, p.journal, p.year, p.doi, s.name AS shelf_name, s.is_public AS shelf_public
    FROM copies c JOIN papers p ON p.sha256 = c.paper_sha256 LEFT JOIN shelves s ON s.uuid = c.shelf_uuid
    WHERE c.user_uuid = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.uuid`, user.uuid);
  const tagsByCopy = new Map<string, string[]>();
  for (const link of await all<{ copy_uuid: string; name: string }>(db, `SELECT l.copy_uuid, t.name FROM copy_tags l JOIN tags t ON t.uuid = l.tag_uuid
      WHERE l.user_uuid = ? AND l.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY lower(t.name)`, user.uuid)) {
    (tagsByCopy.get(link.copy_uuid) ?? tagsByCopy.set(link.copy_uuid, []).get(link.copy_uuid)!).push(link.name);
  }
  const annotations = await all<Row>(db, `SELECT a.*, p.sha256, p.title, p.authors, p.journal, p.year, p.doi FROM annotations a LEFT JOIN papers p ON p.sha256 = a.paper_sha256
    WHERE a.user_uuid = ? AND a.deleted_at IS NULL ORDER BY a.paper_sha256, a.page, a.created_at, a.uuid`, user.uuid);
  const rooms = await all<Row>(db, `SELECT r.*, p.title AS paper_title FROM rooms r JOIN room_participants rp ON rp.room_uuid = r.uuid JOIN papers p ON p.sha256 = r.paper_sha256
    WHERE rp.user_uuid = ? ORDER BY r.created_at, r.uuid`, user.uuid);
  const messages = await all<Row>(db, "SELECT * FROM room_messages WHERE user_uuid = ? ORDER BY created_at, uuid", user.uuid);
  const notifications = await all<Row>(db, "SELECT * FROM notifications WHERE user_uuid = ? ORDER BY created_at, uuid", user.uuid);
  const uploads = await all<Row>(db, "SELECT * FROM papers WHERE uploaded_by = ? ORDER BY created_at, sha256", user.uuid);
  const boards = await all<Row>(db, "SELECT * FROM boards WHERE user_uuid = ? AND deleted_at IS NULL ORDER BY created_at, uuid", user.uuid);
  const groups = await all<Row>(db, "SELECT g.* FROM board_groups g JOIN boards b ON b.uuid = g.board_uuid WHERE b.user_uuid = ? AND b.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY g.created_at, g.uuid", user.uuid);
  const items = await all<Row>(db, "SELECT i.* FROM board_items i JOIN boards b ON b.uuid = i.board_uuid WHERE b.user_uuid = ? AND b.deleted_at IS NULL AND i.deleted_at IS NULL ORDER BY i.created_at, i.uuid", user.uuid);

  const paperOf = (row: Row) => row.sha256 ? paperRef(row) : null;
  return {
    profile: { uuid: user.uuid, email: user.email, display_name: user.display_name, affiliation: user.affiliation, email_public: Boolean(user.email_public), is_admin: Boolean(user.is_admin), joined: user.created_at },
    nook: copies.map((c) => ({
      paper: paperRef(c), summary: c.summary, thought: c.thought, on_display: Boolean(c.shelf_public), shelf: c.shelf_name ?? null, i_am_an_author: Boolean(c.is_author),
      ratings: { expertise: c.rating_expertise, reading: c.rating_reading, liking: c.rating_liking },
      tags: tagsByCopy.get(c.uuid as string) ?? [], added: c.created_at,
    })),
    notes: annotations.filter((a) => a.kind === "note").map((n) => ({
      uuid: n.uuid, paper: paperOf(n), name: n.name, content: n.content, page: n.page, anchor: bodyOf(n).anchor ?? null, written: n.created_at,
    })),
    // Fractions of the page, y from the bottom — the same coordinates a
    // note's anchor uses.
    ink: annotations.filter((a) => a.kind === "ink").map((i) => ({ uuid: i.uuid, paper: paperOf(i), page: i.page, ...bodyOf(i), drawn: i.created_at })),
    seminars: rooms.map((r) => ({
      uuid: r.uuid, paper_title: r.paper_title, status: r.status, scheduled_time: r.scheduled_time, platform: r.platform,
      i_started_it: r.created_by === user.uuid, i_am_leading: r.leader_uuid === user.uuid,
      my_messages: messages.filter((m) => m.room_uuid === r.uuid).map((m) => ({ content: m.content, sent: m.created_at })),
    })),
    notifications: notifications.map((n) => ({ content: n.content, read: Boolean(n.read), received: n.created_at })),
    pdfs_i_uploaded: uploads.map((p) => ({ paper: paperRef(p), file: p.file_path, uploaded: p.created_at })),
    boards: boards.map((b) => ({
      uuid: b.uuid, shelf_uuid: b.shelf_uuid, name: b.name, description: b.description, created: b.created_at, updated: b.updated_at,
      groups: groups.filter((g) => g.board_uuid === b.uuid).map((g) => ({
        uuid: g.uuid, kind: g.kind, title: g.title, header: g.header, auto_arrange: Boolean(g.auto_arrange),
        item_uuids: items.filter((i) => i.board_uuid === b.uuid && i.group_uuid === g.uuid).map((i) => i.uuid),
      })),
      items: items.filter((i) => i.board_uuid === b.uuid).map((i) => ({
        uuid: i.uuid, group_uuid: i.group_uuid ?? null, kind: i.kind, content: i.content, file: i.file_path, original_filename: i.original_filename,
        mime_type: i.mime_type, source_url: i.source_url, text_align: i.text_align, x: i.x, y: i.y, width: i.width, created: i.created_at,
      })),
    })),
  };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

// The notes again, for a person rather than a parser.
function notesMarkdown(data: Gathered, stamp: string): string {
  const lines = [`# Notes — ${data.profile.display_name}`, "", `${data.notes.length} notes, exported ${stamp}.`, ""];
  const byPaper = new Map<string, Gathered["notes"]>();
  for (const note of data.notes) {
    const title = note.paper ? String(note.paper.title) : "(paper since removed)";
    (byPaper.get(title) ?? byPaper.set(title, []).get(title)!).push(note);
  }
  for (const [title, notes] of byPaper) {
    lines.push(`## ${title}`, "");
    for (const note of notes) {
      const where = note.page ? `page ${note.page}` : "not placed on the page";
      let head = `### ${note.name || where}`;
      if (note.name && note.page) head += ` — page ${note.page}`;
      // An anchor with nothing written on it is an annotation, not a note.
      lines.push(head, "", String(note.content || "") || "*(an annotation, with nothing written on it)*", "");
    }
  }
  return lines.join("\n");
}

const README = `Your Papol export
=================

Everything Papol holds about you, as of {date}.

  profile.json        Your account: name, email, affiliation, when you joined.
  nook.json           The papers in your nook, with your ratings, your private
                      summaries and your public one-line thoughts.
  notes.json          Every note you have written, with the page and the exact
                      spot on it where you placed each one.
  notes.md            The same notes, written out to be read.
  ink.json            What you drew on the page with the brush, as points on
                      the page rather than as a picture.
  seminars.json       The seminar cohorts you joined, and what you said in them.
  notifications.json  What Papol has told you.
  uploads.json        The PDFs you contributed.
  boards.json         Your private boards and the position of every item.
  board-files/        Files and images attached to your boards.
  pdfs/               The PDF of every paper in your nook, named after the
                      paper rather than after the upload.
{avatar}
The PDFs are the files as they were uploaded to Papol. They are the
publishers' documents, not Papol's, and your rights over them are whatever
they were before Papol held a copy.

This export does not include your password, which Papol cannot read either
— it stores a hash, not the word you typed.
`;

const KEY = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

// The archive, as a body that is written as it is read. Each entry is
// pushed through the zip and its output handed to the response one
// chunk at a time, so a slow download holds back the reads from R2
// rather than piling their bytes up in memory.
export async function exportZip(env: Env, user: User): Promise<Response> {
  const stamp = new Date().toISOString().slice(0, 10);
  const root = `papol-export-${stamp}`;
  const data = await gather(env.DB, user);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

  const write = async () => {
    const writer = writable.getWriter();
    const pending: Uint8Array[] = [];
    let failed: Error | null = null;
    const zip = new Zip((error, chunk) => { if (error) failed = error; else pending.push(chunk); });
    const flush = async () => {
      if (failed) throw failed;
      for (const chunk of pending.splice(0)) await writer.write(chunk);
    };
    const text = async (name: string, content: string) => {
      const entry = new ZipDeflate(`${root}/${name}`);
      zip.add(entry);
      entry.push(new TextEncoder().encode(content), true);
      await flush();
    };
    // A stored file, copied through as it is: PDFs and images are already
    // compressed. One the store no longer has is left out, as a missing
    // file always was.
    const stored = async (key: string, name: string): Promise<boolean> => {
      if (!KEY.test(key)) return false;
      const object = await env.FILES.get(key);
      if (!object) return false;
      const entry = new ZipPassThrough(`${root}/${name}`);
      zip.add(entry);
      const reader = object.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        entry.push(value);
        await flush();
      }
      entry.push(new Uint8Array(0), true);
      await flush();
      return true;
    };
    try {
      let avatarLine = "";
      if (user.avatar_path) {
        const suffix = user.avatar_path.slice(user.avatar_path.lastIndexOf("."));
        if (await stored(`${UPLOADS}${user.avatar_path}`, `avatar${suffix}`)) avatarLine = `  avatar${suffix}        Your picture.\n`;
      }
      await text("README.txt", README.replace("{date}", stamp).replace("{avatar}", avatarLine));
      const files: [string, unknown][] = [
        ["profile", data.profile], ["nook", data.nook], ["notes", data.notes], ["ink", data.ink], ["seminars", data.seminars],
        ["notifications", data.notifications], ["uploads", data.pdfs_i_uploaded], ["boards", data.boards],
      ];
      for (const [name, payload] of files) await text(`${name}.json`, JSON.stringify(payload, null, 2));
      await text("notes.md", notesMarkdown(data, stamp));

      // One PDF per paper in the nook, named after the paper. Two papers
      // can slug the same, so the second gets a number.
      const seen = new Set<string>();
      for (const kept of await all<{ file_path: string; title: string; year: number | null }>(env.DB,
          "SELECT p.file_path, p.title, p.year FROM copies c JOIN papers p ON p.sha256 = c.paper_sha256 WHERE c.user_uuid = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.uuid", user.uuid)) {
        const base = kept.year ? `${slug(kept.title)}-${kept.year}` : slug(kept.title);
        let candidate = `${base}.pdf`;
        for (let n = 2; seen.has(candidate); n++) candidate = `${base}-${n}.pdf`;
        if (await stored(`${UPLOADS}${kept.file_path}`, `pdfs/${candidate}`)) seen.add(candidate);
      }
      for (const board of data.boards) {
        for (const item of board.items) {
          if (!item.file) continue;
          const filename = String(item.original_filename || String(item.file).split("/").pop()).split("/").pop();
          await stored(`${BOARD_FILES}${item.file}`, `board-files/${board.uuid}/${item.uuid}-${filename}`);
        }
      }
      zip.end();
      await flush();
      await writer.close();
    } catch (error) {
      await writer.abort(error);
    }
  };
  void write();

  return new Response(readable, {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${root}.zip"` },
  });
}
