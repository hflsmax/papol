import React, { useState } from 'react';
import { updateProfile } from '../../../shared/api/account.js';

// Every choice a member makes about how Papol behaves for them, in one
// place: who sees and finds them. Each is
// kept the moment it is changed; there is nothing to save.
export default function PreferencesPanel({ user, onUserUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const keep = async (change) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { onUserUpdated(await updateProfile(change)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const tick = (label, checked, change, note) => (
    <label className="checkbox-row">
      <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => keep(change(e.target.checked))} />
      <span>{label}{note && <span className="preferences-note">{note}</span>}</span>
    </label>
  );

  return (
    <div className="preferences-panel">
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel preferences-block" aria-labelledby="preferences-privacy">
        <h2 className="panel-title" id="preferences-privacy">Privacy</h2>
        {tick('Show my email on my nook', Boolean(user.email_public), (on) => ({ email_public: on }))}
        {tick('Let people find me when they look for friends', user.findable ?? true, (on) => ({ findable: on }),
          'Off, Find in the Lounge does not show you. You can still be asked from your nook.')}
      </section>
    </div>
  );
}
