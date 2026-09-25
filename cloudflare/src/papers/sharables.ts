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
//
// A PDF's digest is a lean link already: its bytes sit in a public bucket
// under that name, so whoever holds the digest holds the paper. The viewer
// URL that names one opens the paper alone for anyone, and a lean sharable
// is only a shorter way of writing it.

import { type User } from "../auth";
import { all, now, one, type Row } from "../db";
import { refuse } from "../http";
import { userPublic } from "../routes/boards";
import { uploadUrl } from "../files";
import { annotationOut, copyOf, type Paper } from "./detail";

export const RICH = "rich";
export const LEAN = "lean";

export interface Sharable extends Row {
  // The link's code: SHARE_CODE_LENGTH characters of CODE_ALPHABET. The
  // column and the wire keep the name they had when it held a UUID.
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

// A code is the whole of the permission to a reading, so it is drawn at
// random rather than counted out: a counter would let anyone walk every
// link there is. Ten characters of digits and both cases are sixty bits,
// which keeps guessing one hopeless even with a great many links out. Case
// matters, so nothing may fold a code to one case. A random byte picks a
// character only when it falls below the largest multiple of sixty-two
// that fits, so no character is likelier than another.
export const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SHARE_CODE_LENGTH = 10;
const FAIR_BYTE = 256 - (256 % CODE_ALPHABET.length);

export function newShareCode(): string {
  let code = "";
  while (code.length < SHARE_CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SHARE_CODE_LENGTH))) {
      if (byte < FAIR_BYTE && code.length < SHARE_CODE_LENGTH) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return code;
}

// What may name a link in a URL.
export function isShareCode(value: string | null | undefined): value is string {
  return !!value && /^[0-9A-Za-z]{10}$/.test(value);
}

// The link this ask calls for, made if there is not one already. Asking
// twice gives the same link back rather than a second one — a user asking
// again means "where is the link", not "give me another" — but what
// "already" means differs with the kind: a reading is theirs, the paper's
// link is anyone's. A revoked link is not resurrected: the next ask mints
// a new code and the old link stays dead.
//
// The table is what remembers which codes are taken, and its primary key
// is what refuses a second one: a code is drawn and inserted, and only if
// the insert collides is another drawn. At sixty bits that is a formality,
// but it is the insert that decides, not a look beforehand that another
// request could overtake.
export async function shareReading(db: D1Database, user: User, paperSha256: string, kind: string): Promise<Sharable> {
  const existing = kind === RICH ? await liveReadingLink(db, user.uuid, paperSha256) : await livePaperLink(db, paperSha256);
  if (existing) return existing;
  for (let attempt = 0; ; attempt++) {
    const sharable: Sharable = { uuid: newShareCode(), kind, user_uuid: kind === RICH ? user.uuid : null, paper_sha256: paperSha256, created_at: now(), revoked_at: null };
    try {
      await db.prepare("INSERT INTO sharables (uuid, kind, user_uuid, paper_sha256, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)")
        .bind(sharable.uuid, sharable.kind, sharable.user_uuid, sharable.paper_sha256, sharable.created_at).run();
      return sharable;
    } catch (failure) {
      if (attempt >= 3 || !/UNIQUE|PRIMARY KEY/i.test(String(failure))) throw failure;
    }
  }
}

// Where a short link sends whoever follows it. A link to the paper alone
// goes to the paper's own viewer URL, which is open to anyone; a reading
// goes to the viewer on its code. A link that no longer opens goes there
// too, so the viewer can say so instead of the site answering 404.
export async function sharableTarget(db: D1Database, code: string): Promise<string> {
  const sharable = await openSharable(db, code);
  if (sharable?.kind === LEAN) return `/viewer/?pdf=${sharable.paper_sha256}`;
  return `/viewer/?share=${encodeURIComponent(code)}`;
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
export async function sharedReading(env: Env, sharable: Sharable) {
  const db = env.DB;
  const paper = await one<Paper>(db, "SELECT * FROM papers WHERE sha256 = ?", sharable.paper_sha256);
  if (!paper) refuse(404, "This reading is no longer shared");
  const maker = sharable.user_uuid ? await one<Row>(db, "SELECT * FROM users WHERE uuid = ?", sharable.user_uuid) : null;
  const annotations = sharable.kind === RICH
    ? await all<Row>(db, "SELECT * FROM annotations WHERE user_uuid = ? AND paper_sha256 = ? AND deleted_at IS NULL ORDER BY created_at, uuid", sharable.user_uuid, sharable.paper_sha256)
    : [];
  return {
    uuid: sharable.uuid, kind: sharable.kind, created_at: sharable.created_at,
    user: maker ? userPublic(maker) : null,
    paper: sharedPaper(env, paper),
    annotations: annotations.map(annotationOut),
  };
}

// The paper a viewer URL names by its digest, as a lean link would open it:
// the PDF and what is known about it, nobody's annotations, nobody named.
export function paperReading(env: Env, paper: Paper) {
  return { uuid: null, kind: LEAN, created_at: null, user: null, paper: sharedPaper(env, paper), annotations: [] };
}

function sharedPaper(env: Env, paper: Paper) {
  return { doi: paper.doi, title: paper.title, authors: paper.authors, journal: paper.journal, year: paper.year, file_path: paper.file_path, file_url: uploadUrl(env, paper.file_path), sha256: paper.sha256 };
}

// The paper a viewer URL names, for anyone. The digest is a lean link in
// itself, so the paper alone needs no other permission; what a link adds
// is a reading, and a link names its own paper, so with one it is the
// file that has to match the URL.
export async function viewerPaper(db: D1Database, digest: string, share: string | null): Promise<Paper> {
  const wanted = digest.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(wanted)) refuse(404, "PDF not found");
  if (share) {
    const sharable = await openSharable(db, share);
    if (!sharable) refuse(404, "This reading is no longer shared");
    if (sharable.paper_sha256 !== wanted) refuse(404, "PDF not found");
  }
  return (await one<Paper>(db, "SELECT * FROM papers WHERE sha256 = ?", wanted)) ?? refuse(404, "PDF not found");
}

// The paper a viewer URL names, for a user who keeps it: what the nook
// viewer opens, and what may spend work on the user's behalf.
export async function keptPaper(db: D1Database, digest: string, user: User | null): Promise<Paper> {
  if (!user) refuse(401, "Not authenticated");
  const paper = await viewerPaper(db, digest, null);
  if (!(await copyOf(db, paper.sha256, user))) refuse(403, "Add this paper to your nook first");
  return paper;
}
