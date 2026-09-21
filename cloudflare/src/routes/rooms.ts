// Seminar rooms: a call for a seminar on a paper, the cohort that
// answers it, and the seminar's way from open to planning to scheduled
// to finished. A room names its paper by the paper's own name — the
// digest — which is not a thing anyone can edit.

import limits from "../../../config/app_limits.json";
import { currentUser, type User } from "../auth";
import { cohortUserUuids } from "../cohorts";
import { all, batch, insert, newUuid, now, one, statement, type Row } from "../db";
import { json, readJson, refuse, type Router } from "../http";
import { paperOr404, roomSummary } from "../papers/detail";
import { userPublic } from "./boards";
import * as validate from "../validate";

interface Room extends Row {
  uuid: string;
  paper_sha256: string;
  created_by: string;
  leader_uuid: string | null;
  status: string;
  scheduled_time: string | null;
  platform: string | null;
  style: string | null;
  style_desc: string | null;
  created_at: string;
}

async function roomOr404(env: Env, uuid: string): Promise<Room> {
  return (await one<Room>(env.DB, "SELECT * FROM rooms WHERE uuid = ?", uuid)) ?? refuse(404, "Cohort not found");
}

async function participantUuids(env: Env, room: Room): Promise<Set<string>> {
  return new Set((await all<{ user_uuid: string }>(env.DB, "SELECT user_uuid FROM room_participants WHERE room_uuid = ?", room.uuid)).map((r) => r.user_uuid));
}

// The row that puts a user in the cohort, if they are not in it.
async function ensureParticipant(env: Env, room: Room, user: User): Promise<D1PreparedStatement[]> {
  if ((await participantUuids(env, room)).has(user.uuid)) return [];
  return [insert(env.DB, "room_participants", { uuid: newUuid(), room_uuid: room.uuid, user_uuid: user.uuid, created_at: now() })];
}

async function requireDisplaying(env: Env, room: Room, user: User, why = "Display this paper to join the cohort") {
  if (!(await cohortUserUuids(env.DB, room.paper_sha256, true)).has(user.uuid)) refuse(403, why);
}

function notify(env: Env, userUuids: Iterable<string>, room: Room, content: string): D1PreparedStatement[] {
  const at = now();
  return [...userUuids].map((uuid) => insert(env.DB, "notifications", { uuid: newUuid(), user_uuid: uuid, room_uuid: room.uuid, content, read: 0, emailed: 0, created_at: at }));
}

async function roomDetail(env: Env, room: Room, viewer: User) {
  const paper = await one<{ title: string; sha256: string }>(env.DB, "SELECT title, sha256 FROM papers WHERE sha256 = ?", room.paper_sha256);
  const messages = await all<Row>(env.DB,
    "SELECT m.uuid, m.content, m.created_at, u.* , u.uuid AS user_uuid FROM room_messages m JOIN users u ON u.uuid = m.user_uuid WHERE m.room_uuid = ? ORDER BY m.created_at, m.uuid", room.uuid);
  const availabilities = await all<Row>(env.DB,
    "SELECT a.uuid, a.availability, a.created_at, u.*, u.uuid AS user_uuid FROM room_availabilities a JOIN users u ON u.uuid = a.user_uuid WHERE a.room_uuid = ? ORDER BY a.created_at, a.uuid", room.uuid);
  const displaying = await cohortUserUuids(env.DB, room.paper_sha256, true);
  return {
    ...(await roomSummary(env.DB, room)),
    paper_title: paper?.title ?? "", paper_sha256: room.paper_sha256,
    messages: messages.map((m) => ({ uuid: m.uuid, content: m.content, created_at: m.created_at, user: userPublic({ ...m, uuid: m.user_uuid }) })),
    availabilities: availabilities.map((a) => ({ uuid: a.uuid, availability: a.availability, created_at: a.created_at, user: userPublic({ ...a, uuid: a.user_uuid }) })),
    // Whether the viewer's own copy of the paper sits on a public shelf,
    // which is what lets them lead. False when they have no copy at all.
    viewer_copy_is_public: displaying.has(viewer.uuid),
  };
}

function saveRoom(env: Env, room: Room): D1PreparedStatement {
  return statement(env.DB, "UPDATE rooms SET leader_uuid = ?, status = ?, scheduled_time = ?, platform = ?, style = ?, style_desc = ? WHERE uuid = ?",
    room.leader_uuid, room.status, room.scheduled_time, room.platform, room.style, room.style_desc, room.uuid);
}

async function paperTitle(env: Env, room: Room): Promise<string> {
  return (await one<{ title: string }>(env.DB, "SELECT title FROM papers WHERE sha256 = ?", room.paper_sha256))?.title ?? "";
}

export function roomRoutes(router: Router) {
  // Call for a seminar on this paper. Only users displaying it may call.
  // Notifies every user of it — including those who keep their copy hidden.
  router.on("POST", "/api/papers/:name/room", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const paper = await paperOr404(env.DB, params.name);
    if (!(await cohortUserUuids(env.DB, paper.sha256, true)).has(user.uuid)) refuse(403, "Display this paper to call a seminar");
    if (await one(env.DB, "SELECT 1 FROM rooms WHERE paper_sha256 = ? AND status IN ('open', 'planning')", paper.sha256)) {
      refuse(400, "A seminar is already being organized");
    }
    const room: Room = { uuid: newUuid(), paper_sha256: paper.sha256, created_by: user.uuid, leader_uuid: null, status: "open",
      scheduled_time: null, platform: null, style: null, style_desc: null, created_at: now() };
    const others = await cohortUserUuids(env.DB, paper.sha256, false);
    others.delete(user.uuid);
    await batch(env.DB, [
      insert(env.DB, "rooms", room),
      insert(env.DB, "room_participants", { uuid: newUuid(), room_uuid: room.uuid, user_uuid: user.uuid, created_at: now() }),
      ...notify(env, others, room, `${user.display_name} called for a seminar on “${paper.title}”. A user of the paper can answer to host.`),
    ]);
    return json(await roomSummary(env.DB, room));
  });

  router.on("GET", "/api/rooms/:uuid", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    return json(await roomDetail(env, await roomOr404(env, params.uuid), user));
  });

  // Answer the call and take charge of the seminar.
  router.on("POST", "/api/rooms/:uuid/lead", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.status !== "open") refuse(400, "This seminar already has a host");
    await requireDisplaying(env, room, user, "Display this paper to host");
    const participants = await participantUuids(env, room);
    if (!participants.has(user.uuid)) refuse(400, "Join the cohort before answering to host");
    room.leader_uuid = user.uuid;
    room.status = "planning";
    const others = new Set([...await cohortUserUuids(env.DB, room.paper_sha256, false), ...participants]);
    others.delete(user.uuid);
    await batch(env.DB, [saveRoom(env, room), ...await ensureParticipant(env, room, user),
      ...notify(env, others, room, `${user.display_name} will host the seminar on “${await paperTitle(env, room)}”. Share your availability in the cohort.`)]);
    return json(await roomDetail(env, room, user));
  });

  // Step back from hosting a seminar still in planning. The room reopens
  // and waits for another user to answer.
  router.on("POST", "/api/rooms/:uuid/unhost", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.leader_uuid !== user.uuid) refuse(403, "Only the host can step back");
    if (room.status !== "planning") refuse(400, "Only a seminar in planning can lose its host");
    room.leader_uuid = null;
    room.status = "open";
    const others = await participantUuids(env, room);
    others.delete(user.uuid);
    await batch(env.DB, [saveRoom(env, room),
      ...notify(env, others, room, `${user.display_name} stepped back from hosting the seminar on “${await paperTitle(env, room)}”. A user of the paper can answer to host.`)]);
    return json(await roomDetail(env, room, user));
  });

  // Withdraw a call that never formed a cohort. Only its caller may, and
  // only while it is active and has no participant other than them: once
  // another user has joined, the seminar is shared state.
  router.on("POST", "/api/rooms/:uuid/uncall", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.created_by !== user.uuid) refuse(403, "Only the caller can uncall this seminar");
    if (!["open", "planning"].includes(room.status)) refuse(400, "Only an active seminar can be uncalled");
    const participants = await participantUuids(env, room);
    participants.delete(user.uuid);
    if (participants.size) refuse(400, "A seminar can only be uncalled when no one else is in the cohort");
    // Invitations link to this room, so they go before the room does.
    await batch(env.DB, ["notifications", "room_availabilities", "room_messages", "room_participants"].map((table) =>
      statement(env.DB, `DELETE FROM ${table} WHERE room_uuid = ?`, room.uuid)).concat(statement(env.DB, "DELETE FROM rooms WHERE uuid = ?", room.uuid)));
    return json({ message: "Seminar uncalled" });
  });

  router.on("POST", "/api/rooms/:uuid/join", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    await requireDisplaying(env, room, user);
    await batch(env.DB, await ensureParticipant(env, room, user));
    return json(await roomDetail(env, room, user));
  });

  // Leave the cohort. A host leaving an active seminar must appoint a
  // cohort member to host in their place.
  router.on("POST", "/api/rooms/:uuid/leave", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    const participants = await participantUuids(env, room);
    if (!participants.has(user.uuid)) refuse(400, "You are not in this cohort");
    const data = request.headers.get("content-length") && request.headers.get("content-length") !== "0" ? await readJson<Row>(request) : {};
    const statements: D1PreparedStatement[] = [];
    if (room.leader_uuid === user.uuid && room.status !== "finished") {
      const successor = typeof data.successor_uuid === "string" ? data.successor_uuid : null;
      if (!successor) refuse(400, "Appoint a cohort member to host before leaving");
      if (successor === user.uuid || !participants.has(successor) || !(await one(env.DB, "SELECT 1 FROM users WHERE uuid = ?", successor))) refuse(400, "Choose another cohort member");
      if (!(await cohortUserUuids(env.DB, room.paper_sha256, true)).has(successor)) refuse(400, "Display this paper to host");
      room.leader_uuid = successor;
      statements.push(saveRoom(env, room), ...notify(env, [successor], room, `${user.display_name} handed you hosting of the seminar on “${await paperTitle(env, room)}”.`));
    }
    statements.push(
      statement(env.DB, "DELETE FROM room_participants WHERE room_uuid = ? AND user_uuid = ?", room.uuid, user.uuid),
      statement(env.DB, "DELETE FROM room_availabilities WHERE room_uuid = ? AND user_uuid = ?", room.uuid, user.uuid),
    );
    await batch(env.DB, statements);
    return json(await roomDetail(env, room, user));
  });

  router.on("POST", "/api/rooms/:uuid/messages", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    await requireDisplaying(env, room, user);
    if (!(await participantUuids(env, room)).has(user.uuid)) refuse(400, "Join the cohort before posting a message");
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const content = check.string("content", data.content, { min: 1, max: limits.text.room_message });
    check.done();
    await insert(env.DB, "room_messages", { uuid: newUuid(), room_uuid: room.uuid, user_uuid: user.uuid, content: content!.trim(), created_at: now() }).run();
    return json(await roomDetail(env, room, user));
  });

  router.on("POST", "/api/rooms/:uuid/availability", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.status === "scheduled") refuse(400, "This seminar has already been scheduled");
    await requireDisplaying(env, room, user);
    if (!(await participantUuids(env, room)).has(user.uuid)) refuse(400, "Join the cohort before sharing availability");
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const availability = check.string("availability", data.availability, { min: 1, max: limits.text.availability });
    check.done();
    const existing = await one<{ uuid: string }>(env.DB, "SELECT uuid FROM room_availabilities WHERE room_uuid = ? AND user_uuid = ?", room.uuid, user.uuid);
    await (existing
      ? statement(env.DB, "UPDATE room_availabilities SET availability = ? WHERE uuid = ?", availability, existing.uuid)
      : insert(env.DB, "room_availabilities", { uuid: newUuid(), room_uuid: room.uuid, user_uuid: user.uuid, availability, created_at: now() })).run();
    return json(await roomDetail(env, room, user));
  });

  // Announce the seminar's time, platform and style — or edit them later
  // (host only). The style is a preset key from the frontend's list, or
  // the host's own title with its description.
  router.on("PUT", "/api/rooms/:uuid/announce", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.leader_uuid !== user.uuid) refuse(403, "Only the host can announce");
    if (!["planning", "scheduled"].includes(room.status)) refuse(400, "This seminar is not being planned");
    const data = await readJson<Row>(request);
    const check = validate.checking();
    const scheduledTime = check.string("scheduled_time", data.scheduled_time, { min: 1, max: limits.text.scheduled_time });
    const platform = check.string("platform", data.platform, { min: 1, max: limits.text.platform });
    const style = check.string("style", data.style, { min: 1, max: limits.text.room_style });
    const styleDesc = check.string("style_desc", data.style_desc, { max: limits.text.room_style_description, optional: true });
    check.done();
    const editing = room.status === "scheduled";
    Object.assign(room, { scheduled_time: scheduledTime, platform, style: style!.trim(), style_desc: styleDesc?.trim() || null, status: "scheduled" });
    const others = new Set([...await cohortUserUuids(env.DB, room.paper_sha256, false), ...await participantUuids(env, room)]);
    others.delete(user.uuid);
    await batch(env.DB, [saveRoom(env, room),
      ...notify(env, others, room, `Seminar on “${await paperTitle(env, room)}” ${editing ? "updated" : "scheduled"}: ${scheduledTime} · ${platform}.`)]);
    return json(await roomDetail(env, room, user));
  });

  // Mark the seminar as held (host only).
  router.on("POST", "/api/rooms/:uuid/finish", async ({ request, env, params }) => {
    const user = await currentUser(request, env);
    const room = await roomOr404(env, params.uuid);
    if (room.leader_uuid !== user.uuid) refuse(403, "Only the host can finish the seminar");
    if (room.status !== "scheduled") refuse(400, "Schedule the seminar first");
    room.status = "finished";
    await saveRoom(env, room).run();
    return json(await roomDetail(env, room, user));
  });
}
