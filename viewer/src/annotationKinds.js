/**
 * Three ways of reading one annotation interface.
 *
 * Anchors, ink and clips are stored, synchronized and served as one thing —
 * `source.annotations` — because they differ only in geometry. They are still
 * three different things to *draw*: a pin at a point, a painted path, a
 * movable view of part of the page. The viewer keeps those three
 * apart, and this is where the one interface is presented as the three.
 *
 * Each kind's geometry lives in `body` on the wire. Rendering code reads it
 * flat — `stroke.points`, `clip.frame` — so an annotation is spread on the way out
 * and gathered on the way in.
 */

const flatten = (row) => (row ? { ...row, ...(row.body || {}) } : row);

const ofKind = (kind) => (rows) => rows.filter((row) => row.kind === kind).map(flatten);

export const anchorsIn = ofKind('anchor');
export const inkIn = ofKind('ink');
export const clipsIn = ofKind('clip');

export function annotationKinds(annotations) {
  if (!annotations) return null;
  const { list, create, update, remove, restore } = annotations;
  const made = (kind) => async (annotation) => flatten(await create({ kind, ...annotation }));
  const changed = async (uuid, changes) => flatten(await update(uuid, changes));

  return {
    anchors: list && {
      list: async () => anchorsIn(await list('anchor')),
      create: create && (({ page, anchor }) => made('anchor')({ page, body: { anchor } })),
      move: update && ((uuid, { page, anchor }) => changed(uuid, { page, body: { anchor } })),
      remove,
      restore: restore && ((uuid, { page, anchor }) => restore(uuid, { page, body: { anchor } })),
    },
    ink: list && {
      list: async () => inkIn(await list('ink')),
      create: create && (({ page, group_uuid: groupUuid, ...body }) => made('ink')({
        page, group_uuid: groupUuid ?? null, body,
      })),
      // Carrying a stroke says where its points are now. The nib it was
      // drawn with is not part of the answer, so it is not sent.
      move: update && ((uuid, points) => changed(uuid, { body: { points } })),
      remove,
    },
    clips: list && {
      list: async () => clipsIn(await list('clip')),
      create: create && (({ page, ...body }) => made('clip')({
        page, body,
      })),
      move: update && ((uuid, frame, floating) => changed(uuid, { body: { frame, floating } })),
      remove,
    },
  };
}
