// What a failed synchronization means for the person using Papol.
//
// The native synchronizer reports a failure as one line of text, and the
// line a server refusal becomes is "Sync server returned <status>: <body>".
// Each kind below is answered once, in one place, and never only on the
// settings page:
//
// - incompatible: this build is one the server no longer speaks to. Every
//   window is covered by the update screen (shared/ui/CompatibilityGate).
// - signed_out: the session this Mac held was refused. Papol asks the user
//   to sign in again, as it does for any refused request.
// - offline: the network is not there. Offline mode says so already.
// - reportable: a defect on this Mac. The error report is offered.
// - server / other: the sync did not finish for a reason the user cannot
//   act on beyond trying again. The desk window says so once, in a
//   sentence, with Try again and Details.

export function isOfflineNativeSyncError(error) {
  const message = error?.message || String(error || '');
  return /\b(?:network|offline|dns|tcp|tls|certificate)\b|connect(?:ion)? (?:error|failed|refused|reset)|error (?:sending request|trying to connect)|timed? out|timeout/i.test(message);
}

export function isReportableNativeSyncError(error) {
  const message = error?.message || String(error || '');
  return /applying (?:pushed rows|snapshot|pull page) failed|local database|database lock|constraint failed|server (?:sent|row)|push result row|pulled row|synchronized columns/i.test(message);
}

export const SYNC_ATTENTION_EVENT = 'papol-sync-attention';

const REFUSAL = /Sync server returned (\d{3})[^:]*(?::\s*([\s\S]*))?$/;

function refusal(message) {
  const match = REFUSAL.exec(message);
  if (!match) return null;
  let body = null;
  try { body = match[2] ? JSON.parse(match[2]) : null; } catch { body = null; }
  return { status: Number(match[1]), body };
}

// The server wraps a refusal in `detail`; the update link is inside it.
function downloadUrl(body) {
  const url = body?.detail?.download_url ?? body?.download_url;
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : null;
}

function serverDetail(body) {
  const detail = body?.detail;
  return typeof detail === 'string' && detail.trim() ? detail.trim() : null;
}

export function classifySyncFailure(error) {
  const message = String(error?.message ?? error ?? '').trim();
  const refused = refusal(message);
  const status = refused?.status ?? null;

  if (status === 426 || /client_incompatible/.test(message)) {
    return {
      kind: 'incompatible',
      text: 'This version of Papol can no longer sync. Update Papol to keep syncing.',
      downloadUrl: downloadUrl(refused?.body),
      signature: 'incompatible',
    };
  }
  if (status === 401) {
    return {
      kind: 'signed_out',
      text: 'Your session on this Mac has ended. Sign in again to keep syncing.',
      signature: 'signed_out',
    };
  }
  if (!refused && isOfflineNativeSyncError(message)) {
    return { kind: 'offline', text: 'Papol is offline.', signature: 'offline' };
  }
  if (isReportableNativeSyncError(message)) {
    return { kind: 'reportable', text: 'Papol hit a problem on this Mac while syncing.', signature: `reportable:${message}` };
  }
  if (status !== null && status >= 500) {
    return {
      kind: 'server',
      text: 'Papol’s server could not finish the sync just now. Your changes are safe on this Mac.',
      signature: `server:${status}`,
    };
  }
  const detail = serverDetail(refused?.body);
  return {
    kind: 'other',
    text: detail ? `Sync did not finish: ${detail}` : 'Sync did not finish. Your changes are safe on this Mac.',
    signature: `other:${status ?? message}`,
  };
}

// The line the settings page and the Sync button show for a failure: the
// same sentence the prompt uses, never the raw server response.
export function syncFailureText(error) {
  if (!error) return null;
  return classifySyncFailure(error).text;
}
