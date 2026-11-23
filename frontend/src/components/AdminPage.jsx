import React, { useState, useEffect } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { confirmAction } from '../../../shared/confirmAction';
import { FEATURE_STATES, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates';
import {
  adminListTables,
  adminGetTable,
  adminUpdateRow,
  adminDeleteRow,
  adminRunSql,
  adminListFeedback,
  adminSetFeedbackResolved,
  adminSendMessage,
  adminListMessageRecipients,
  adminSendAnnouncement,
  adminListEmails,
  adminGetEmail,
  adminListUsers,
} from '../../../shared/api/admin.js';
import appLimits from '../../../shared/appLimits.js';
import { nextSort, sortIndicator, sortRows } from '../adminSort.js';
import { NEWSLETTER_DRAFTS } from '../newsletterDrafts.js';
import { ago, readingTime, USER_WINDOWS, windowLabel } from '../adminUsers.js';
import MarkdownField from '../../../shared/ui/MarkdownField.jsx';

// The open accounts a broadcast can go to, for the audience picker.
function useRecipients(setError) {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    adminListMessageRecipients()
      .then(setRecipients)
      .catch((failure) => setError(failure.message))
      .finally(() => setLoading(false));
  }, []);
  return { recipients, loading };
}

// Everyone, or the users picked from a searchable list.
function AudiencePicker({ name, audience, setAudience, recipients, loading, selected, setSelected }) {
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const shownRecipients = recipients.filter((recipient) =>
    !normalizedSearch || [recipient.display_name, recipient.email, recipient.affiliation]
      .some((value) => value?.toLowerCase().includes(normalizedSearch))
  );

  const toggleRecipient = (uuid) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  return (
    <>
      <fieldset className="admin-message-audience">
        <legend className="form-label">Recipients</legend>
        <label className="checkbox-row">
          <input
            type="radio"
            name={name}
            checked={audience === 'all'}
            onChange={() => setAudience('all')}
          />
          <span>Everyone <small>All current users</small></span>
        </label>
        <label className="checkbox-row">
          <input
            type="radio"
            name={name}
            checked={audience === 'selected'}
            onChange={() => setAudience('selected')}
          />
          <span>Selected users <small>Choose one or more users</small></span>
        </label>
      </fieldset>
      {audience === 'selected' && (
        <div className="admin-recipient-picker">
          <label htmlFor={`${name}-search`}>Find users</label>
          <input
            id={`${name}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email, or affiliation…"
          />
          <p className="admin-recipient-count" role="status">
            {selected.size} selected
          </p>
          {loading ? (
            <Working label="Loading users…" />
          ) : (
            <ul className="admin-recipient-list">
              {shownRecipients.map((recipient) => (
                <li key={recipient.uuid}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={selected.has(recipient.uuid)}
                      onChange={() => toggleRecipient(recipient.uuid)}
                    />
                    <span>
                      <strong>{recipient.display_name}</strong>
                      <small>{recipient.email}{recipient.affiliation ? ` · ${recipient.affiliation}` : ''}</small>
                    </span>
                  </label>
                </li>
              ))}
              {shownRecipients.length === 0 && (
                <li className="no-comments">No matching users.</li>
              )}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function AdminMessagePanel() {
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const { recipients, loading: loadingRecipients } = useRecipients(setError);

  const send = async (event) => {
    event.preventDefault();
    const message = content.trim();
    if (!message) return;
    const userUuids = audience === 'all' ? null : [...selected];
    const audienceDescription = audience === 'all'
      ? 'every current Papol user'
      : `${selected.size} selected ${selected.size === 1 ? 'user' : 'users'}`;
    if (!(await confirmAction(
      `Send this message to ${audienceDescription}?`,
      { confirmLabel: audience === 'all' ? 'Send to everyone' : 'Send to selected users' },
    ))) return;

    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminSendMessage(message, userUuids);
      setContent('');
      if (audience === 'selected') setSelected(new Set());
      setNotice(
        `Message sent to ${result.recipient_count} ${result.recipient_count === 1 ? 'user' : 'users'}.`,
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="admin-message-compose" onSubmit={send}>
      <p className="panel-note">
        This appears when each recipient next opens Papol. Once dismissed, it
        will not appear to that user again.
      </p>
      <AudiencePicker
        name="admin-message-audience"
        audience={audience}
        setAudience={setAudience}
        recipients={recipients}
        loading={loadingRecipients}
        selected={selected}
        setSelected={setSelected}
      />
      <div className="form-group">
        <label htmlFor="admin-message-content">Message</label>
        <textarea
          id="admin-message-content"
          rows="5"
          maxLength={appLimits.text.admin_message}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Write a message to Papol users…"
        />
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="success" role="status">{notice}</div>}
      <button
        className="primary"
        type="submit"
        disabled={
          sending || !content.trim() ||
          (audience === 'selected' && (loadingRecipients || selected.size === 0))
        }
      >
        {sending ? 'Sending…' : audience === 'all' ? 'Send to everyone' : 'Send to selected users'}
      </button>
    </form>
  );
}

// Resend writes "2026-09-22 09:50:31.069000+00".
const sentDate = (at) => new Date(`${at.slice(0, 23).replace(' ', 'T')}Z`);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const statusSummary = (emails) => {
  const counts = {};
  for (const email of emails) {
    const status = email.status || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(', ');
};

// What one send said: its text, or its HTML shown as the recipient saw it.
function SentEmailBody({ id }) {
  const [body, setBody] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminGetEmail(id).then(setBody).catch((failure) => setError(failure.message));
  }, [id]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!body) return <Working label="Loading the email…" />;
  if (body.text) return <p className="feedback-content sent-email-text">{body.text}</p>;
  if (body.html) {
    return <iframe className="sent-email-html" title="The email as sent" sandbox="" srcDoc={body.html} />;
  }
  return <p className="no-papers">Resend kept no body for this email.</p>;
}

// Announcements to write, and every email Papol has sent, as Resend
// recorded it.
function EmailPanel() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // A letter drafted in newsletters/, chosen to start from: it fills the
  // subject and the body, which stay free to edit.
  const [draft, setDraft] = useState('');
  const [audience, setAudience] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [record, setRecord] = useState(null);
  const [recordError, setRecordError] = useState(null);
  const [open, setOpen] = useState(null);
  const { recipients, loading: loadingRecipients } = useRecipients(setError);

  const loadRecord = () => {
    setRecordError(null);
    adminListEmails().then(setRecord).catch((failure) => setRecordError(failure.message));
  };

  useEffect(loadRecord, []);

  const send = async (test) => {
    if (!subject.trim() || !body.trim()) return;
    const userUuids = audience === 'all' ? null : [...selected];
    if (!test) {
      const audienceDescription = audience === 'all'
        ? 'every current Papol user'
        : plural(selected.size, 'selected user');
      if (!(await confirmAction(
        `Email “${subject.trim()}” to ${audienceDescription}? Email cannot be taken back.`,
        { confirmLabel: audience === 'all' ? 'Email everyone' : 'Email selected users' },
      ))) return;
    }

    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminSendAnnouncement(subject, body, { userUuids, test });
      if (test) {
        setNotice('A test copy is on its way to you.');
      } else {
        setSubject('');
        setBody('');
        if (audience === 'selected') setSelected(new Set());
        setNotice(`Emailing ${plural(result.recipient_count, 'user')}.`);
      }
      // The job sends within seconds; the record shows it once Resend has it.
      setTimeout(loadRecord, 5000);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSending(false);
    }
  };

  const configured = record?.configured !== false;
  const ready = configured && !sending && subject.trim() && body.trim() &&
    !(audience === 'selected' && (loadingRecipients || selected.size === 0));

  return (
    <>
      <form className="admin-message-compose" onSubmit={(event) => { event.preventDefault(); send(false); }}>
        <p className="panel-note">
          Each recipient gets an email of their own
          {record?.from ? <>, from <code>{record.from}</code></> : null}.
          Write it in Markdown: <code>**bold**</code>, <code>[a link](https://…)</code>,{' '}
          <code>![a picture](https://files.papol.io/admin/…)</code>. It arrives as a formatted email,
          pictures and all, with a plain-text copy for mail apps that show no formatting.
          Send yourself a test copy first.
        </p>
        {!configured && (
          <div className="error" role="alert">Email is not configured on this server.</div>
        )}
        <AudiencePicker
          name="admin-email-audience"
          audience={audience}
          setAudience={setAudience}
          recipients={recipients}
          loading={loadingRecipients}
          selected={selected}
          setSelected={setSelected}
        />
        {NEWSLETTER_DRAFTS.length > 0 && (
          <div className="form-group">
            <label htmlFor="admin-email-draft">Draft</label>
            <select
              id="admin-email-draft"
              value={draft}
              onChange={(event) => {
                const chosen = NEWSLETTER_DRAFTS.find((d) => d.name === event.target.value);
                setDraft(event.target.value);
                if (chosen) {
                  setSubject(chosen.subject);
                  setBody(chosen.body);
                }
              }}
            >
              <option value="">Start from a blank email</option>
              {NEWSLETTER_DRAFTS.map((d) => (
                <option key={d.name} value={d.name}>{d.name}: {d.subject}</option>
              ))}
            </select>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="admin-email-subject">Subject</label>
          <input
            id="admin-email-subject"
            type="text"
            maxLength={appLimits.text.announcement_subject}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="What the email is about…"
          />
        </div>
        <div className="form-group">
          <label htmlFor="admin-email-body">Email</label>
          <MarkdownField
            id="admin-email-body"
            aria-label="Email"
            rows="12"
            maxLength={appLimits.text.announcement_body}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write the email in Markdown…"
          />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success" role="status">{notice}</div>}
        <div className="admin-email-actions">
          <button type="button" disabled={!ready} onClick={() => send(true)}>
            Send a test to me
          </button>
          <button className="primary" type="submit" disabled={!ready}>
            {sending ? 'Sending…' : audience === 'all' ? 'Email everyone' : 'Email selected users'}
          </button>
        </div>
      </form>

      <h6 className="kicker">
        Sent{' '}
        <button className="link-button" onClick={loadRecord}>Refresh</button>
      </h6>
      {recordError && <div className="error" role="alert">{recordError}</div>}
      {!record && !recordError && <div className="loading"><Working label="Loading sent email…" /></div>}
      {record && configured && record.sends.length === 0 && <p className="no-papers">Nothing sent yet.</p>}
      {record && record.sends.length > 0 && (
        <ul className="feedback-list">
          {record.sends.map((sent) => {
            const key = sent.emails[0].id;
            const expanded = open === key;
            return (
              <li key={key} className="feedback-item">
                <p className="feedback-head">
                  {sentDate(sent.sent_at).toLocaleString()} ·{' '}
                  {sent.emails.length === 1 ? sent.emails[0].to : plural(sent.emails.length, 'recipient')} ·{' '}
                  {statusSummary(sent.emails)}
                  {sent.from !== record.from ? ` · from ${sent.from}` : ''}
                </p>
                <button
                  className="link-button sent-email-subject"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : key)}
                >
                  {sent.subject}
                </button>
                {expanded && (
                  <div className="sent-email-detail">
                    {sent.emails.length > 1 && (
                      <p className="feedback-head">
                        {sent.emails.map((email) => `${email.to} (${email.status || 'unknown'})`).join(', ')}
                      </p>
                    )}
                    <SentEmailBody id={key} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// How long before the report a step came, by the reporter's own clock.
function before(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const DID = { open: 'opened', click: 'pressed', error: 'error' };

// Reports written before the move to Cloudflare carry their time without
// a zone, and newer ones with a Z: both are UTC.
const reportedAt = (iso) => new Date(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`).toLocaleString();

// Where the reporter was and what they had just done.
function FeedbackContext({ context: c }) {
  const where = [c.title && `“${c.title}”`, c.project && `in ${c.project}`].filter(Boolean).join(' ');
  const app = [c.runtime === 'mac' ? 'Mac' : 'Web', c.app, c.window && `${c.window} window`, c.version].filter(Boolean).join(' · ');
  const device = [`${c.browser} on ${c.system}`, c.viewport, c.language, c.online === false && 'offline'].filter(Boolean).join(' · ');
  return (
    <div className="feedback-context">
      {where && <p>{where}</p>}
      <p>{app} · {device}</p>
      {c.trail.length > 0 && (
        <details>
          <summary>Leading up to it</summary>
          <ol>
            {c.trail.map((step, index) => (
              <li key={index} className={step.kind === 'error' ? 'feedback-step failed' : 'feedback-step'}>
                <span>−{before(c.sent_at - step.at)}</span>
                <span>{DID[step.kind]} {step.what}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function FeedbackPanel({ onOpenCount }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    adminListFeedback()
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (items) onOpenCount?.(items.filter((f) => !f.resolved).length);
  }, [items]);

  const toggle = async (fb) => {
    try {
      const updated = await adminSetFeedbackResolved(fb.uuid, !fb.resolved);
      setItems((list) => list.map((x) => (x.uuid === fb.uuid ? updated : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!items) return <div className="loading"><Working label="Loading reports…" /></div>;

  const open = items.filter((f) => !f.resolved);
  const done = items.filter((f) => f.resolved);
  const shown = showResolved ? items : open;

  const who = (fb) => {
    if (fb.user) return `${fb.user.display_name} <${fb.user_email}>`;
    if (fb.contact) return `a visitor <${fb.contact}>`;
    return 'an anonymous visitor';
  };

  return (
    <>
      <p className="panel-note">
        {open.length} open, {done.length} done.{' '}
        {done.length > 0 && (
          <button
            className="link-button"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'Hide the done ones' : 'Show the done ones'}
          </button>
        )}
      </p>
      {shown.length === 0 ? (
        <p className="no-papers">No reports.</p>
      ) : (
        <ul className="feedback-list">
          {shown.map((fb) => (
            <li
              key={fb.uuid}
              className={fb.resolved ? 'feedback-item resolved' : 'feedback-item'}
            >
              <p className="feedback-head">
                {who(fb)}
                {fb.page && <> · <a href={fb.page}>{fb.page}</a></>} ·{' '}
                {reportedAt(fb.created_at)}
              </p>
              <p className="feedback-content">{fb.content}</p>
              {fb.context && <FeedbackContext context={fb.context} />}
              <button className="link-button" onClick={() => toggle(fb)}>
                {fb.resolved ? 'Reopen' : 'Mark done'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const readFeatureStates = () => Object.fromEntries(
  FEATURE_STATES.map((state) => [state.key, isFeatureStateSet(state)])
);

// Lessons Papol has shown and choices the user made, as this browser
// remembers them (shared/featureStates.js), each on a switch.
function FeatureStatesPanel() {
  const [states, setStates] = useState(readFeatureStates);
  const [error, setError] = useState(null);

  // The viewer, open in another tab, can change them while this page is up.
  useEffect(() => {
    const refresh = () => setStates(readFeatureStates());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  const apply = (changes) => {
    const saved = changes.map(([state, on]) => setFeatureState(state, on)).every(Boolean);
    setError(saved ? null : 'This browser would not save the change.');
    setStates(readFeatureStates());
  };

  const anySet = FEATURE_STATES.some((state) => states[state.key]);

  return (
    <>
      <p className="panel-note">
        Kept in this browser only; the viewer picks up a change the next time it opens.{' '}
        {anySet && (
          <button
            className="link-button"
            onClick={() => apply(FEATURE_STATES.map((state) => [state, false]))}
          >
            Reset all
          </button>
        )}
      </p>
      {error && <div className="error" role="alert">{error}</div>}
      <ul className="feature-state-list">
        {FEATURE_STATES.map((state) => {
          const on = states[state.key];
          const label = on ? state.setLabel : state.unsetLabel;
          return (
            <li key={state.key} className="feature-state">
              <div className="feature-state-body">
                <strong>{state.name}</strong>
                <span>{state.description}</span>
                <code>{state.key}</code>
              </div>
              <button
                className={`switch-toggle ${on ? 'on' : 'off'}`}
                role="switch"
                aria-checked={on}
                aria-label={`${state.name}: ${label}`}
                onClick={() => apply([[state, !on]])}
              >
                <span className="switch">
                  <span className="switch-knob" />
                  <span className="switch-text">{label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const PLATFORM = { macos: 'Mac', web: 'Web' };

// One list of users with what each has made. `when` is the column the list
// is about (last active, or joined); the other date sits under it.
function UserTable({ users, when, recentDays, label }) {
  const [sort, setSort] = useState(null);
  const columns = [
    { key: 'display_name', label: 'User' },
    { key: when, label: when === 'last_active_at' ? 'Last active' : 'Joined' },
    { key: 'papers', label: 'Papers', number: true },
    { key: 'digs', label: 'Digs', number: true },
    { key: 'anchors', label: 'Anchors', number: true },
    { key: 'reading_recent_seconds', label: 'Reading', title: `Reading time in the ${windowLabel(recentDays)}, and in all`, number: true },
    { key: 'friends', label: 'Friends', number: true },
    { key: 'projects', label: 'Projects', number: true },
  ];
  if (users.length === 0) return <p className="no-papers">Nobody in the {windowLabel(recentDays)}.</p>;
  const rows = sortRows(users, sort);
  return (
    <div className="admin-table-wrap">
      <table className="admin-table admin-users-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const { ariaSort, arrow } = sortIndicator(sort, c.key);
              return (
                <th key={c.key} aria-sort={ariaSort} className={c.number ? 'number' : undefined}>
                  <button className="admin-sort" onClick={() => setSort(nextSort(sort, c.key))} title={c.title ?? `Sort by ${c.label.toLowerCase()}`}>
                    {c.label}
                    <span className="admin-sort-arrow" aria-hidden="true">{arrow}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.uuid}>
              <td className="admin-user">
                <strong>{u.display_name}{u.is_admin && <span className="admin-user-badge">admin</span>}</strong>
                <small title={u.email}>{u.email}{u.affiliation ? ` · ${u.affiliation}` : ''}</small>
              </td>
              <td className="admin-user-when">
                <span title={u[when] ? new Date(u[when]).toLocaleString() : undefined}>{ago(u[when])}</span>
                <small>
                  {when === 'last_active_at'
                    ? `joined ${ago(u.created_at)}`
                    : u.last_active_at ? `seen ${ago(u.last_active_at)}` : 'not seen yet'}
                  {u.platform && ` · ${PLATFORM[u.platform] ?? u.platform}`}
                </small>
              </td>
              <td className="number">{u.papers || '—'}</td>
              <td className="number">{u.digs || '—'}</td>
              <td className="number">{u.anchors || '—'}</td>
              <td className="number">
                {readingTime(u.reading_recent_seconds)}
                <small>{u.reading_seconds ? `${readingTime(u.reading_seconds)} in all` : ''}</small>
              </td>
              <td className="number">{u.friends || '—'}</td>
              <td className="number">{u.projects || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WindowPicker({ id, value, onChange }) {
  return (
    <select id={id} className="admin-users-window" value={value} onChange={(event) => onChange(Number(event.target.value))}>
      {USER_WINDOWS.map((days) => <option key={days} value={days}>{windowLabel(days)}</option>)}
    </select>
  );
}

// Who has used Papol lately and who has just joined, with what each has
// made: papers on their shelves, digs, anchors, reading time, friends and
// projects.
function UsersPanel() {
  const [activeDays, setActiveDays] = useState(7);
  const [newDays, setNewDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let current = true;
    setError(null);
    adminListUsers({ activeDays, newDays })
      .then((d) => { if (current) setData(d); })
      .catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [activeDays, newDays]);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return <div className="loading"><Working label="Loading users…" /></div>;

  const shown = (count, list) => (count > list.length ? ` (newest ${list.length} shown)` : '');
  return (
    <>
      <p className="panel-note">
        {data.total_users} {data.total_users === 1 ? 'account' : 'accounts'}.{' '}
        {data.active_count} active in the {windowLabel(data.active_days)},{' '}
        {data.new_count} joined in the {windowLabel(data.new_days)}.
      </p>
      <div className="admin-users-head">
        <h3>Recently active <span className="admin-users-count">{data.active_count}</span></h3>
        <label htmlFor="admin-users-active-window">Seen in the</label>
        <WindowPicker id="admin-users-active-window" value={activeDays} onChange={setActiveDays} />
      </div>
      {shown(data.active_count, data.active) && <p className="panel-note">{shown(data.active_count, data.active)}</p>}
      <UserTable users={data.active} when="last_active_at" recentDays={data.active_days} label="Recently active users" />
      <div className="admin-users-head">
        <h3>New <span className="admin-users-count">{data.new_count}</span></h3>
        <label htmlFor="admin-users-new-window">Joined in the</label>
        <WindowPicker id="admin-users-new-window" value={newDays} onChange={setNewDays} />
      </div>
      {shown(data.new_count, data.new) && <p className="panel-note">{shown(data.new_count, data.new)}</p>}
      <UserTable users={data.new} when="created_at" recentDays={data.active_days} label="New users" />
    </>
  );
}

// Every table as it is, a row at a time, and one raw statement: no
// validation, so it comes last.
function DatabasePanel() {
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [sort, setSort] = useState(null);
  const [sql, setSql] = useState('');
  const [sqlResult, setSqlResult] = useState(null);
  const [sqlError, setSqlError] = useState(null);

  useEffect(() => {
    adminListTables()
      .then((d) => {
        setTables(d.tables);
        // Users is the table an admin opens most; the sync bookkeeping
        // that sorts first is the one opened least.
        if (d.tables.length > 0) setSelected(d.tables.includes('users') ? 'users' : d.tables[0]);
      })
      .catch((e) => setError(e.message));
  }, []);

  const loadTable = (name) => {
    setError(null);
    setNotice(null);
    setEdits({});
    setData(null);
    adminGetTable(name)
      .then(setData)
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    // Each table has its own columns, so a sort cannot outlive the one it
    // was made on.
    setSort(null);
    if (selected) loadTable(selected);
  }, [selected]);

  if (error && !data) return <div className="error" role="alert">{error}</div>;

  const pkName = data?.primary_key?.[0];
  // The panel is sent one page of the table, so a sort orders the rows in
  // hand rather than asking the database for the smallest or the largest.
  const sortedRows = sortRows(data?.rows ?? [], sort);

  const cellValue = (row, col) => {
    const pk = row[pkName];
    const edited = edits[pk]?.[col];
    if (edited !== undefined) return edited;
    const v = row[col];
    return v === null || v === undefined ? '' : String(v);
  };

  const setCell = (pk, col, value) => {
    setEdits((prev) => ({ ...prev, [pk]: { ...prev[pk], [col]: value } }));
  };

  const saveRow = async (row) => {
    const pk = row[pkName];
    const changed = edits[pk];
    if (!changed) return;
    setError(null);
    setNotice(null);
    try {
      await adminUpdateRow(selected, pk, changed);
      setNotice(`Row ${pk} updated.`);
      loadTable(selected);
    } catch (e) {
      setError(e.message);
    }
  };

  const deleteRow = async (row) => {
    const pk = row[pkName];
    if (!(await confirmAction(`Delete row ${pk} from ${selected}?`, { confirmLabel: 'Delete row', destructive: true }))) return;
    setError(null);
    setNotice(null);
    try {
      await adminDeleteRow(selected, pk);
      setNotice(`Row ${pk} deleted.`);
      loadTable(selected);
    } catch (e) {
      setError(e.message);
    }
  };

  const runSql = async () => {
    setSqlError(null);
    setSqlResult(null);
    try {
      const result = await adminRunSql(sql);
      setSqlResult(result);
      if (selected) loadTable(selected);
    } catch (e) {
      setSqlError(e.message);
    }
  };

  return (
    <>
      <div className="panel">
        <h2 className="panel-title">Tables</h2>
        <p className="panel-note">Direct database access, with no validation. A row is saved as typed.</p>

        <div className="admin-table-picker">
          <label htmlFor="admin-table-select">Table</label>
          <select id="admin-table-select" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {data && <span className="admin-table-count">{data.rows.length === appLimits.counts.admin_table_rows ? `first ${data.rows.length} rows` : `${data.rows.length} ${data.rows.length === 1 ? 'row' : 'rows'}`}</span>}
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success">{notice}</div>}

        {!data ? (
          <div className="loading"><Working label={`Loading ${selected}…`} /></div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {data.columns.map((c) => {
                    const { ariaSort, arrow } = sortIndicator(sort, c);
                    return (
                      <th key={c} aria-sort={ariaSort}>
                        <button
                          className="admin-sort"
                          onClick={() => setSort(nextSort(sort, c))}
                          title={`Sort by ${c}`}
                        >
                          {c}
                          {c === pkName ? ' 🔑' : ''}
                          <span className="admin-sort-arrow" aria-hidden="true">{arrow}</span>
                        </button>
                      </th>
                    );
                  })}
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row[pkName]}>
                    {data.columns.map((col) => (
                      <td key={col}>
                        {col === pkName ? (
                          <span className="admin-pk">{String(row[col])}</span>
                        ) : (
                          <input
                            value={cellValue(row, col)}
                            onChange={(e) => setCell(row[pkName], col, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                    <td className="admin-row-actions">
                      <button
                        disabled={!edits[row[pkName]]}
                        onClick={() => saveRow(row)}
                      >
                        Save
                      </button>
                      <button
                        className="link-button danger"
                        onClick={() => deleteRow(row)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <p className="no-papers">Empty table.</p>}
          </div>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">SQL</h2>
        <p className="panel-note">One statement at a time. Anything that returns rows shows them here.</p>
        <textarea
          className="admin-sql"
          rows="3"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder="e.g. UPDATE papers SET year = 2025 WHERE uuid = '…';  (also use for INSERTs)"
        />
        <button className="primary" disabled={!sql.trim()} onClick={runSql}>
          Run
        </button>

        {sqlError && <div className="error sql-error">{sqlError}</div>}
        {sqlResult && (
          <div className="admin-sql-result">
            {sqlResult.rows ? (
              sqlResult.rows.length === 0 ? (
                <p className="no-papers">No rows returned.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        {sqlResult.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sqlResult.rows.map((row, i) => (
                        <tr key={i}>
                          {sqlResult.columns.map((c) => (
                            <td key={c}>{row[c] === null ? 'NULL' : String(row[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <p className="success">Done — {sqlResult.rowcount} row(s) affected.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// The admin page's sections, one shown at a time, named in the address so
// a reload or a link lands on the same one.
const SECTIONS = [
  { key: 'users', label: 'Users', title: 'Users', Panel: UsersPanel },
  { key: 'feedback', label: 'Reports', title: 'Bug reports and feature requests', Panel: FeedbackPanel },
  { key: 'message', label: 'Message', title: 'Message users in Papol', Panel: AdminMessagePanel },
  { key: 'email', label: 'Email', title: 'Email users', Panel: EmailPanel },
  { key: 'introductions', label: 'Introductions', title: 'Feature introductions', Panel: FeatureStatesPanel },
  { key: 'database', label: 'Database', Panel: DatabasePanel },
];

const sectionFromHash = () => {
  const key = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#/, '');
  return SECTIONS.some((section) => section.key === key) ? key : SECTIONS[0].key;
};

export default function AdminPage() {
  const [current, setCurrent] = useState(sectionFromHash);
  const [openReports, setOpenReports] = useState(null);

  useEffect(() => {
    const follow = () => setCurrent(sectionFromHash());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  // The open reports are counted on the Reports tab wherever the admin is.
  useEffect(() => {
    adminListFeedback()
      .then((items) => setOpenReports(items.filter((f) => !f.resolved).length))
      .catch(() => {});
  }, []);

  const open = (key) => {
    setCurrent(key);
    window.history.replaceState(null, '', `#${key}`);
  };

  const section = SECTIONS.find((s) => s.key === current);
  const { Panel } = section;
  return (
    <div className="admin-page">
      <nav className="admin-sections" aria-label="Admin sections">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={s.key === current ? 'admin-section active' : 'admin-section'}
            aria-current={s.key === current ? 'page' : undefined}
            onClick={() => open(s.key)}
          >
            {s.label}
            {s.key === 'feedback' && openReports > 0 && <span className="admin-section-count">{openReports}</span>}
          </button>
        ))}
      </nav>
      {section.title ? (
        <div className="panel">
          <h2 className="panel-title">{section.title}</h2>
          <Panel onOpenCount={setOpenReports} />
        </div>
      ) : (
        <Panel />
      )}
    </div>
  );
}
