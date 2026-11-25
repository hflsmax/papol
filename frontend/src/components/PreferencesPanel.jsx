import React, { Fragment, useState } from 'react';
import { updateProfile } from '../../../shared/api/account.js';
import { chooseTheme, readTheme } from '../../../shared/theme.js';

// Every choice a member makes about how Papol behaves for them, in one
// place: how it looks, who sees and finds them, and what Papol emails
// them of its own accord. Each is
// kept the moment it is chosen; there is nothing to save. How it looks is
// this device's (shared/theme.js); the rest are the account's.
//
// The emails a member may turn off, in the order shown. Which of them
// this member has is the server's to say (`user.emails`): an admin has one
// more. What is always sent is named under them, so the block is every
// email Papol sends.
const EMAILS = [
  ['friend_request', 'Friend requests'],
  ['friend_suggestions', 'Friend suggestions, once a week'],
  ['feedback_report', 'Feedback reports'],
];

export default function PreferencesPanel({ user, onUserUpdated }) {
  const emails = user.emails ?? {};
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(readTheme);

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
      <section className="panel preferences-block" aria-labelledby="preferences-appearance">
        <h2 className="panel-title" id="preferences-appearance">Appearance</h2>
        <div className="local-setting-row preferences-row">
          <label htmlFor="preference-theme"><strong>Theme</strong> <span className="preferences-scope">on this device</span></label>
          <select id="preference-theme" value={theme} onChange={(e) => setTheme(chooseTheme(e.target.value))}>
            <option value="system">Same as system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>
      <section className="panel preferences-block" aria-labelledby="preferences-privacy">
        <h2 className="panel-title" id="preferences-privacy">Privacy</h2>
        {choice('preference-email', 'My email on my nook', Boolean(user.email_public), 'Shown', 'Hidden', (on) => ({ email_public: on }))}
        {choice('preference-findable', 'People searching my name', user.findable ?? true, 'Can find me', 'Cannot find me', (on) => ({ findable: on }))}
      </section>
      <section className="panel preferences-block" aria-labelledby="preferences-email">
        <h2 className="panel-title" id="preferences-email">Email</h2>
        {EMAILS.filter(([kind]) => kind in emails).map(([kind, label]) => (
          <Fragment key={kind}>{choice(`preference-email-${kind}`, label, emails[kind], 'Email me', 'No email', (on) => ({ emails: { [kind]: on } }))}</Fragment>
        ))}
        <p className="panel-note preferences-always">Always sent: a password reset you ask for, and announcements from Papol.</p>
      </section>
    </div>
  );
}
