export function planOfflineNookAddition(paper, shelves, createUuid) {
  const shelf = shelves.find((row) => row.is_default === true || row.is_default === 1)
    || shelves[0];
  const copyUuid = createUuid();
  return {
    copyUuid,
    change: {
      table: 'copies', uuid: copyUuid, operation: 'upsert',
      values: {
        paper_sha256: paper.sha256, shelf_uuid: shelf?.uuid ?? null,
      },
    },
  };
}
