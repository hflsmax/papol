import React, { useState } from 'react';
import navMarks from '../../../config/nav_marks.json' with { type: 'json' };
import { updateProfile } from '../../../shared/api/account.js';

// Every choice a member makes about how Papol behaves for them, in one
// place: who sees and finds them, and what the reader marks. Each is
// kept the moment it is changed; there is nothing to save.
export default function PreferencesPanel({ user, onUserUpdated }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const marks = Array.isArray(user.nav_marks) ? user.nav_marks : navMarks.shown;

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
      <section className="panel preferences-block" aria-labelledby="preferences-reader">
        <h2 className="panel-title" id="preferences-reader">Reader</h2>
        <p className="panel-note">What the navigation bar marks above a paper while you read.</p>
        <div className="preferences-marks">
          {navMarks.kinds.map((kind) => (
            <React.Fragment key={kind}>
              {tick(navMarks.names[kind], marks.includes(kind),
                (on) => ({ nav_marks: navMarks.kinds.filter((k) => (k === kind ? on : marks.includes(k))) }))}
            </React.Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}
