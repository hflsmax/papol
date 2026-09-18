// Expected refusals stay at the form; defects offer a diagnostic report.
export function isReportableUploadError(error) {
  if (error?.reportable === false) return false;
  if ([400, 401, 403, 409, 413, 415, 422, 429, 501].includes(error?.status)) return false;
  const message = error?.message || String(error || '');
  return !/\b(?:offline|failed to fetch|fetch failed|load failed|network(?:error| error| request failed)|timed? out|timeout|connection (?:refused|reset)|offline files may be at most|no space left on device)\b/i.test(message);
}
