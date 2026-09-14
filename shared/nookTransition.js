export function planOfflineNookAddition(paper, shelves, createUuid) {
  const shelf = shelves.find((row) => row.is_default === true || row.is_default === 1)
    || shelves[0];
  if (!shelf) throw new Error('Your nook is still loading. Sync and try again.');
  const edition = paper.editions?.find((row) => row.uuid === paper.edition_uuid)
    || paper.latest_edition || paper.editions?.[0] || null;
  const copyUuid = createUuid();
  return {
    copyUuid,
    change: {
      table: 'copies', uuid: copyUuid, operation: 'upsert',
      values: {
        paper_uuid: paper.uuid, shelf_uuid: shelf.uuid,
        edition_uuid: edition?.uuid || null, edition_sha256: edition?.sha256 || null,
      },
    },
  };
}
