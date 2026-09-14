export function diagnosticLogExcerpt(events, maximumLength = 1800) {
  const lines = (events || []).map((event) => JSON.stringify(event));
  const selected = [];
  let length = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (length + line.length + 1 > maximumLength) break;
    selected.unshift(line);
    length += line.length + 1;
  }
  return selected.join('\n');
}

export function feedbackWithDiagnosticLog(content, excerpt, maximumLength) {
  const report = String(content || '').trim();
  if (!excerpt) return report.slice(0, maximumLength);
  const heading = '\n\nRecent diagnostic events (oldest to newest):\n';
  const available = maximumLength - report.length - heading.length;
  if (available <= 0) return report.slice(0, maximumLength);
  return `${report}${heading}${excerpt.slice(-available)}`;
}
