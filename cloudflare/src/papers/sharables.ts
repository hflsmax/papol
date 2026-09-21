// Sharables: one user's reading of one paper, given away by link.
//
// A user's annotations are private. A sharable is the single, deliberate
// exception: it names a reading — this user, this PDF — and whoever holds
// the link may read it, signed in or not. The UUID in the link is the
// whole of the permission, so everything here is about establishing that
// the UUID is live and then answering with exactly the reading it names,
// and nothing else in that user's nook.
//
// A link carries one of two things, and whose it is follows from which. A
// *rich* link carries the reading: the PDF with this user's annotations on
// it. It is theirs — it sits on their paper page, and only they can take
// their annotations out of it or close it. A *lean* link carries the PDF
// alone, and is nobody's: one per paper, handed to whoever asks, naming
// no user and implying none. Which one a link is gets decided when it is
// made, and never rises afterwards.
//
// The reading is named rather than copied, so what a visitor sees is what
// the user has now. Take the paper out of the nook and the reading a rich
// link named no longer exists, so the link becomes lean instead of dying:
// the paper is what remains of it. Revoking is what closes a link.

import { type User } from "../auth";
import { all, newUuid, now, one, type Row } from "../db";
import { refuse } from "../http";
import { userPublic } from "../routes/boards";
import { annotationOut, copyOf, type Paper } from "./detail";

export const RICH = "rich";
export const LEAN = "lean";

export interface Sharable extends Row {
  uuid: string;
  kind: string;
  user_uuid: string | null;
  paper_sha256: string;
  created_at: string;
  revoked_at: string | null;
}

export function sharableOut(sharable: Sharable) {
  return { uuid: sharable.uuid, kind: sharable.kind, paper_sha256: sharable.paper_sha256, created_at: sharable.created_at };
}

// The live sharable named by a link, or null if there is no such link or
// its maker has taken it back.
//
// Every link comes through here, which is why the demotion lives here
// too: a paper can leave a nook down two different roads — the web
// endpoint and a synchronized delete from the desktop — and only this one
// is common to both.
export async function openSharable(db: D1Database, uuid: string | null | undefined): Promise<Sharable | null> {
  if (!uuid) return null;
  const sharable = await one<Sharable>(db, "SELECT * FROM sharables WHERE uuid = ? AND revoked_at IS NULL", uuid);
  if (!sharable) return null;
  if (sharable.kind === RICH) {
    // A user who closed their account left their nook behind as a
    // tombstone; nothing of theirs is handed out under their name again.
    // Only a reading can be withdrawn this way — a link to the paper
    // alone was never theirs to take with them.
    const maker = sharable.user_uuid ? await one<{ deleted_at: string | null }>(db, "SELECT deleted_at FROM users WHERE uuid = ?", sharable.user_uuid) : null;
    if (!maker || maker.deleted_at) return null;
    const kept = await one(db, "SELECT 1 FROM copies WHERE user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL", sharable.user_uuid, sharable.paper_sha256);
    // Written down rather than worked out on each read, so that putting
    // the paper back cannot quietly re-enrich a link already handed out.
    if (!kept) await stripToThePaper(db, sharable);
  }
  return sharable;
}

// The link this user has out for this paper, if any. Always one carrying
// their annotations: a link to the paper alone is nobody's, so it is not
// theirs to be shown, stopped, or held against them.
export function liveReadingLink(db: D1Database, userUuid: string, paperSha256: string): Promise<Sharable | null> {
  return one<Sharable>(db, "SELECT * FROM sharables WHERE user_uuid = ? AND kind = 'rich' AND paper_sha256 = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    userUuid, paperSha256);
}

// The link this paper already has out to the PDF alone, if any. Not
// keyed to whoever asks: the PDF has one address, and two users handing
// the same paper on hand on the same link.
function livePaperLink(db: D1Database, paperSha256: string): Promise<Sharable | null> {
  return one<Sharable>(db, "SELECT * FROM sharables WHERE kind = 'lean' AND user_uuid IS NULL AND paper_sha256 = ? AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
    paperSha256);
}

// The link this ask calls for, made if there is not one already. Asking
// twice gives the same link back rather than a second one — a user asking
// again means "where is the link", not "give me another" — but what
// "already" means differs with the kind: a reading is theirs, the paper's
// link is anyone's. A revoked link is not resurrected: the next ask mints
// a new UUID and the old link stays dead.
export async function shareReading(db: D1Database, user: User, paperSha256: string, kind: string): Promise<Sharable> {
  const existing = kind === RICH ? await liveReadingLink(db, user.uuid, paperSha256) : await livePaperLink(db, paperSha256);
  if (existing) return existing;
  const sharable: Sharable = { uuid: newUuid(), kind, user_uuid: kind === RICH ? user.uuid : null, paper_sha256: paperSha256, created_at: now(), revoked_at: null };
  await db.prepare("INSERT INTO sharables (uuid, kind, user_uuid, paper_sha256, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)")
    .bind(sharable.uuid, sharable.kind, sharable.user_uuid, sharable.paper_sha256, sharable.created_at).run();
  return sharable;
}

// What is left of a reading once the annotations are gone: the paper,
// held by nobody. The user is released from it in the same stroke, so it
// leaves their paper page and there is nothing more for them to do to it.
// Only ever downwards: the people holding a lean link were never promised
// the annotations.
export async function stripToThePaper(db: D1Database, sharable: Sharable): Promise<Sharable> {
  if (sharable.kind === LEAN) return sharable;
  sharable.kind = LEAN;
  sharable.user_uuid = null;
  await db.prepare("UPDATE sharables SET kind = 'lean', user_uuid = NULL WHERE uuid = ?").bind(sharable.uuid).run();
  return sharable;
}

export async function revoke(db: D1Database, sharable: Sharable): Promise<void> {
  if (sharable.revoked_at) return;
  sharable.revoked_at = now();
  await db.prepare("UPDATE sharables SET revoked_at = ? WHERE uuid = ?").bind(sharable.revoked_at, sharable.uuid).run();
}

// Everything the link opens, and nothing else. The paper carries no
// `uuid` and no way to its own page: a link hands over one reading of one
// PDF, and the page behind it belongs to the Library, which is for people
// with accounts. A lean link was never carrying annotations, and a rich
// one that lost its copy has already been demoted by openSharable, so the
// kind is the whole answer.
export async function sharedReading(db: D1Database, sharable: Sharable) {
  const paper = await one<Paper>(db, "SELECT * FROM papers WHERE sha256 = ?", sharable.paper_sha256);
  if (!paper) refuse(404, "This reading is no longer shared");
  const maker = sharable.user_uuid ? await one<Row>(db, "SELECT * FROM users WHERE uuid = ?", sharable.user_uuid) : null;
  const annotations = sharable.kind === RICH
    ? await all<Row>(db, "SELECT * FROM annotations WHERE user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL ORDER BY created_at, uuid", sharable.user_uuid, sharable.paper_sha256)
    : [];
  return {
    uuid: sharable.uuid, kind: sharable.kind, created_at: sharable.created_at,
    user: maker ? userPublic(maker) : null,
    paper: { doi: paper.doi, title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year, file_path: paper.file_path, sha256: paper.sha256 },
    annotations: annotations.map(annotationOut),
  };
}

// The paper a viewer URL names, if whoever asked may read it. Two ways to
// be allowed: the user keeps the paper, or they hold a link someone
// shared. A link names its own paper, so it is the file that has to match
// the URL rather than the user.
export async function viewerPaper(db: D1Database, digest: string, user: User | null, share: string | null): Promise<Paper> {
  const wanted = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wanted)) refuse(404, "PDF not found");
  if (share) {
    const sharable = await openSharable(db, share);
    if (!sharable) refuse(404, "This reading is no longer shared");
    if (sharable.paper_sha256 !== wanted) refuse(404, "PDF not found");
    return (await one<Paper>(db, "SELECT * FROM papers WHERE sha256 = ?", wanted)) ?? refuse(404, "PDF not found");
  }
  if (!user) refuse(401, "Not authenticated");
  const paper = await one<Paper>(db, "SELECT * FROM papers WHERE sha256 = ?", wanted);
  if (!paper) refuse(404, "PDF not found");
  if (!(await copyOf(db, paper.sha256, user))) refuse(403, "Add this paper to your nook first");
  return paper;
}
