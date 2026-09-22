const OPTIONAL_PREVIEW_KINDS = new Set(['youtube', 'bilibili', 'webpage']);

export function hasCardPreview(item) {
  if (item.kind === 'image') return true;
  return OPTIONAL_PREVIEW_KINDS.has(item.kind) && Boolean(item.sha256 || item.file_path);
}
