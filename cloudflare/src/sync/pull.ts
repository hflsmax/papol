// What a replica takes from the server: the whole of its account, and
// then what changed.

import limits from "../../../config/app_limits.json";
import { currentUser } from "../auth";
import { all, batch, newUuid, now, one, statement, type Row } from "../db";
import { json, refuse, type RouteContext } from "../http";
import { appVersion, requireSupportedClient } from "./client";
import { forgetAcknowledged, forgetOldReplays } from "./log";
import { WRITE_ORDER } from "./registry";
import { rowSnapshot } from "./rows";

// The account's synchronized rows, complete, with the papers its copies
// name. This is the authoritative half of a pull: every reconciliation
// fetches it first, so a replica that missed a change learns the same
// state here a moment later. Listed parents before children, which is
// the order a replica can store them in.
export async function snapshot({ request, env }: RouteContext): Promise<Response> {
  requireSupportedClient(request);
  const user = await currentUser(request, env);
  const mine = (table: string) => all(env.DB, `SELECT * FROM ${table} WHERE user_uuid = ?`, user.uuid);
  const throughBoards = (table: string) => all(env.DB,
    `SELECT t.* FROM ${table} t JOIN boards b ON b.uuid = t.board_uuid WHERE b.user_uuid = ?`, user.uuid);
  const byTable: Record<string, Row[]> = {
    papers: await all(env.DB, "SELECT p.* FROM papers p WHERE p.sha256 IN (SELECT paper_sha256 FROM copies WHERE user_uuid = ?)", user.uuid),
    shelves: await mine("shelves"),
    tags: await mine("tags"),
    boards: await mine("boards"),
    board_groups: await throughBoards("board_groups"),
    board_items: await throughBoards("board_items"),
    annotations: await mine("annotations"),
    copies: await mine("copies"),
    copy_tags: await mine("copy_tags"),
  };
  const rows: Row[] = [];
  for (const table of WRITE_ORDER) {
    for (const row of byTable[table]) rows.push({ ...(await rowSnapshot(env.DB, table, row)), table });
  }
  return json({ rows });
}

interface Change extends Row {
  sequence: number;
  table_name: string;
  row_json: string;
}

// The changes after a cursor, a page at a time. A replica that names
// itself is remembered: the cursor it has stored is what the log may be
// let go of up to, and the build it runs is read off its User-Agent.
export async function pull({ request, env, url }: RouteContext): Promise<Response> {
  requireSupportedClient(request);
  const user = await currentUser(request, env);
  const cursor = Number(url.searchParams.get("cursor") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? limits.counts.sync_pull_default);
  const clientUuid = url.searchParams.get("client_uuid");
  if (!Number.isInteger(cursor) || cursor < 0) refuse(422, "cursor must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > limits.counts.sync_pull_max) {
    refuse(422, `limit must be between 1 and ${limits.counts.sync_pull_max}`);
  }
  if (clientUuid) {
    if (!/^[0-9a-f-]{36}$/i.test(clientUuid)) refuse(422, "client_uuid must be a UUID");
    const known = await one<{ uuid: string; acknowledged_cursor: number; app_version: string | null }>(
      env.DB, "SELECT uuid, acknowledged_cursor, app_version FROM _server_clients WHERE user_uuid = ? AND client_uuid = ?",
      user.uuid, clientUuid.toLowerCase(),
    );
    // A version that cannot be read leaves the last good one in place.
    const version = appVersion(request.headers.get("user-agent")) ?? known?.app_version ?? null;
    const remember = known
      ? statement(env.DB, "UPDATE _server_clients SET acknowledged_cursor = ?, last_seen_at = ?, app_version = ? WHERE uuid = ?",
          Math.max(known.acknowledged_cursor, cursor), now(), version, known.uuid)
      : statement(env.DB, "INSERT INTO _server_clients (uuid, user_uuid, client_uuid, acknowledged_cursor, last_seen_at, app_version) VALUES (?, ?, ?, ?, ?, ?)",
          newUuid(), user.uuid, clientUuid.toLowerCase(), cursor, now(), version);
    // A replica moving its cursor forward is the only moment anything
    // learns that a change has been taken everywhere it was going. It is
    // where the log stops being needed, so it is where the log is let go
    // of, and the reply this client can no longer be retrying goes with it.
    await batch(env.DB, [remember, forgetAcknowledged(env.DB, user.uuid), forgetOldReplays(env.DB, user.uuid)]);
  }
  const records = await all<Change>(
    env.DB,
    "SELECT sequence, table_name, row_json FROM _server_change_log WHERE user_uuid = ? AND sequence > ? ORDER BY sequence LIMIT ?",
    user.uuid, cursor, limit + 1,
  );
  const page = records.slice(0, limit);
  return json({
    cursor: page.length ? page[page.length - 1].sequence : cursor,
    has_more: records.length > limit,
    // A change is the row as it was after it: that carries its name, its
    // revision and whether it is a tombstone, so nothing is said twice.
    changes: page.map((record) => ({ table: record.table_name, row: JSON.parse(record.row_json) })),
  });
}
