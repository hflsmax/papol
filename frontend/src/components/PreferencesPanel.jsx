import React, { useState } from 'react';
import { updateProfile } from '../../../shared/api/account.js';

// Every choice a member makes about how Papol behaves for them, in one
// place: who sees and finds them. Each is
// kept the moment it is chosen; there is nothing to save.
export default function PreferencesPanel({ user, onUserUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const keep = async (change) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { onUserUpdated(await updateProfile(change)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  // A choice and its dropdown, as "On this Mac" sets its own.
  const choice = (id, label, on, yes, no, change) => (
    <div className="local-setting-row preferences-row">
      <label htmlFor={id}><strong>{label}</strong></label>
      <select id={id} value={on ? 'on' : 'off'} disabled={busy} onChange={(e) => keep(change(e.target.value === 'on'))}>
        <option value="on">{yes}</option>
        <option value="off">{no}</option>
      </select>
    </div>
  );

  return (
    <div className="preferences-panel">
      {error && <div className="error" role="alert">{error}</div>}
      <section className="panel preferences-block" aria-labelledby="preferences-privacy">
        <h2 className="panel-title" id="preferences-privacy">Privacy</h2>
        {choice('preference-email', 'My email on my nook', Boolean(user.email_public), 'Shown', 'Hidden', (on) => ({ email_public: on }))}
        {choice('preference-findable', 'People looking for friends', user.findable ?? true, 'Can find me', 'Cannot find me', (on) => ({ findable: on }))}
      </section>
    </div>
  );
}
