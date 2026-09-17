const copyUuids = new Map();
const pendingPaperBlobs = new Map();

export function rememberPaperIdentity(paper) {
  if (paper?.sha256 != null && paper.copy_uuid) copyUuids.set(paper.sha256, paper.copy_uuid);
  return paper;
}

export function paperCopyUuid(paperSha256) {
  return copyUuids.get(paperSha256);
}

export function setPaperCopyUuid(paperSha256, copyUuid) {
  copyUuids.set(paperSha256, copyUuid);
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
