// Where a user left a paper: the point at the middle of the viewer, in the
// page's own fractions, and the zoom. The viewer keeps it in its own
// storage as the reader moves, and sends it here so that the other places
// they read (the website, the Mac) open the paper there too. The newest
// place wins, by when the reader was there, not by when it arrived: a
// place sent late from a window that was offline does not undo reading
// done since.

import { currentUser } from "../auth";
import { one, statement, type Row } from "../db";
import { DIGEST } from "../files";
import { json, readJson, refuse, type Router } from "../http";

const PAGE_MAX = 100_000;
const SCALE_MAX = 20;

export interface ReadingPlace {
  page: number;
  x: number;
  y: number;
  scale: number;
  read_at: string;
}

const fraction = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

// A place as a viewer sent it, or null for one that cannot be true. A time
// ahead of the server's clock is taken as now, so a fast clock cannot pin
// a place against reading done later elsewhere.
export function placeOf(value: unknown, at = Date.now()): ReadingPlace | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const { page, x, y, scale } = row;
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > PAGE_MAX) return null;
  if (!fraction(x) || !fraction(y)) return null;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 || scale > SCALE_MAX) return null;
  if (typeof row.read_at !== "string" || row.read_at.length > 40) return null;
  const readAt = Date.parse(row.read_at);
  if (!Number.isFinite(readAt)) return null;
  return {
    page, x: x as number, y: y as number, scale,
    read_at: new Date(Math.min(readAt, at)).toISOString(),
  };
}

export function readingPlaceRoutes(router: Router) {
  router.on("GET", "/api/reading-places/:sha256", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = params.sha256.toLowerCase();
    if (!DIGEST.test(paper)) refuse(404, "Paper not found");
    const place = await one<ReadingPlace>(env.DB,
      "SELECT page, x, y, scale, read_at FROM reading_places WHERE user_uuid = ? AND paper_sha256 = ?",
      user.uuid, paper);
    return json({ place: place ?? null });
  });

  router.on("PUT", "/api/reading-places/:sha256", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = params.sha256.toLowerCase();
    if (!DIGEST.test(paper)) refuse(404, "Paper not found");
    const place = placeOf(await readJson<Row>(request));
    if (!place) refuse(400, "A place is a page, x and y as fractions of it, a zoom, and when it was read");
    if (!await one(env.DB, "SELECT 1 AS found FROM papers WHERE sha256 = ?", paper)) refuse(404, "Paper not found");
    // Kept only when it is newer than the one already there.
    await statement(env.DB,
      `INSERT INTO reading_places (user_uuid, paper_sha256, page, x, y, scale, read_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_uuid, paper_sha256) DO UPDATE SET
         page = excluded.page, x = excluded.x, y = excluded.y, scale = excluded.scale, read_at = excluded.read_at
       WHERE excluded.read_at > reading_places.read_at`,
      user.uuid, paper, place.page, place.x, place.y, place.scale, place.read_at).run();
    const kept = await one<ReadingPlace>(env.DB,
      "SELECT page, x, y, scale, read_at FROM reading_places WHERE user_uuid = ? AND paper_sha256 = ?",
      user.uuid, paper);
    return json({ place: kept });
  });
}
