// Whether the bar offers "Show in nook" rather than "Add to nook": only
// when the lookup of this user's nook found a copy of the paper.
//
// A file opened from disk carries its digest from the start: it is how the
// viewer reads the bytes. So the digest on the paper says nothing about the
// nook, and asking for it offered "Show in nook" on every opened file,
// which only raised the Desk and left no way to add the paper. That went
// unseen from the move to keying papers by their file until the macOS
// end-to-end check pressed the button. The lookup's answer is the only
// thing that says the paper is there.
export function showInNookTarget(source, nookCopy) {
  if (!nookCopy) return null;
  if (source?.openedFile) return nookCopy.sha256 || null;
  return source?.nookHref?.(nookCopy) || null;
}
