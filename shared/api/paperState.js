const copyUuids = new Map();
const pendingPaperBlobs = new Map();

export function rememberPaperIdentity(paper) {
  if (paper?.uuid != null && paper.copy_uuid) copyUuids.set(paper.uuid, paper.copy_uuid);
  return paper;
}

export function paperCopyUuid(paperUuid) {
  return copyUuids.get(paperUuid);
}

export function setPaperCopyUuid(paperUuid, copyUuid) {
  copyUuids.set(paperUuid, copyUuid);
}

export function rememberPendingPaperBlob(blob) {
  pendingPaperBlobs.set(blob.sha256, blob);
}

export function hasPendingPaperBlob(sha256) {
  return pendingPaperBlobs.has(sha256);
}

export function forgetPendingPaperBlob(sha256) {
  pendingPaperBlobs.delete(sha256);
}

export function resetPaperState() {
  copyUuids.clear();
  pendingPaperBlobs.clear();
}
