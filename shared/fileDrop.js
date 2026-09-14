export function carriesFiles(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes('Files');
}

export function isPdfFile(file) {
  if (!file) return false;
  return file.type?.toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

// Some operating systems conceal a dragged file's MIME type until drop. An
// unknown type remains provisionally acceptable and is validated by name once
// the File is available; a known non-PDF can be rejected immediately.
export function libraryFileDragState(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []).filter((item) => item.kind === 'file');
  return items.some((item) => item.type && item.type.toLowerCase() !== 'application/pdf')
    ? 'reject'
    : 'accept';
}
