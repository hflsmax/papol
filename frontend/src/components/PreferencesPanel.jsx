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
  // A chip that is on or off, as a tag chip is when it narrows a list.
  const chip = (label, on, change) => (
    <button type="button" className={`tag-chip preferences-chip${on ? ' selected' : ''}`} aria-pressed={on} disabled={busy} onClick={() => keep(change(!on))}>
      {label}
    </button>
  );

  return (
    <div className="preferences-panel">
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel preferences-block" aria-labelledby="preferences-privacy">
        <h2 className="panel-title" id="preferences-privacy">Privacy</h2>
        <div className="preferences-chips">
          {chip('Show my email on my nook', Boolean(user.email_public), (on) => ({ email_public: on }))}
          {chip('Let people find me when they look for friends', user.findable ?? true, (on) => ({ findable: on }))}
        </div>
      </section>
    </div>
  );
}
