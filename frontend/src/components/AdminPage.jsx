import React, { useState, useEffect } from 'react';
import { confirmAction } from '../../../shared/confirmAction';
import { FEATURE_STATES, isFeatureStateSet, setFeatureState } from '../../../shared/featureStates';
import {
  adminListTables,
  adminGetTable,
  adminUpdateRow,
  adminDeleteRow,
  adminRunSql,
  adminDbMetrics,
  adminResetDbMetrics,
  adminListFeedback,
  adminSetFeedbackResolved,
  adminSendMessage,
  adminListMessageRecipients,
} from '../../../shared/api/admin.js';
import appLimits from '../../../shared/appLimits.js';
import { nextSort, sortIndicator, sortRows } from '../adminSort.js';

function AdminMessagePanel() {
  const [content, setContent] = useState('');
  const [audience, setAudience] = useState('all');
  const [recipients, setRecipients] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    adminListMessageRecipients()
      .then(setRecipients)
      .catch((failure) => setError(failure.message))
      .finally(() => setLoadingRecipients(false));
  }, []);

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
      <fieldset className="admin-message-audience">
        <legend className="form-label">Recipients</legend>
        <label className="checkbox-row">
          <input
            type="radio"
            name="admin-message-audience"
            checked={audience === 'all'}
            onChange={() => setAudience('all')}
          />
          <span>Everyone <small>All current users</small></span>
        </label>
        <label className="checkbox-row">
          <input
            type="radio"
            name="admin-message-audience"
            checked={audience === 'selected'}
            onChange={() => setAudience('selected')}
          />
          <span>Selected users <small>Choose one or more users</small></span>
        </label>
      </fieldset>
      {audience === 'selected' && (
        <div className="admin-recipient-picker">
          <label htmlFor="admin-recipient-search">Find users</label>
          <input
            id="admin-recipient-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email, or affiliation…"
          />
          <p className="admin-recipient-count" role="status">
            {selected.size} selected
          </p>
          {loadingRecipients ? (
            <p className="panel-note" role="status">Loading users…</p>
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

function DbMetricsPanel() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  const load = (promise) =>
    promise.then(setMetrics).catch((e) => setError(e.message));

  useEffect(() => {
    load(adminDbMetrics());
  }, []);

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!metrics) return <div className="loading" role="status" aria-live="polite">Loading metrics…</div>;

  return (
    <>
      <p className="panel-note">
        {metrics.total_queries} quer{metrics.total_queries === 1 ? 'y' : 'ies'}
        {' '}({metrics.total_ms} ms total) since{' '}
        {new Date(metrics.since + 'Z').toLocaleString()}.{' '}
        <button className="link-btn" onClick={() => load(adminDbMetrics())}>
          Refresh
        </button>{' '}
        <button className="link-btn" onClick={() => load(adminResetDbMetrics())}>
          Reset
        </button>
      </p>
      {metrics.operations.length === 0 ? (
        <p className="no-papers">No database operations recorded yet.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>operation</th>
                <th>table</th>
                <th>count</th>
                <th>avg ms</th>
                <th>max ms</th>
                <th>total ms</th>
              </tr>
            </thead>
            <tbody>
              {metrics.operations.map((op) => (
                <tr key={`${op.operation}:${op.table}`}>
                  <td>{op.operation}</td>
                  <td>{op.table}</td>
                  <td>{op.count}</td>
                  <td>{op.avg_ms}</td>
                  <td>{op.max_ms}</td>
                  <td>{op.total_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {metrics.slowest.length > 0 && (
        <>
          <h6 className="mini-title metrics-subtitle">Slowest queries</h6>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ms</th>
                  <th>statement</th>
                </tr>
              </thead>
              <tbody>
                {metrics.slowest.map((q, i) => (
                  <tr key={i}>
                    <td>{q.ms}</td>
                    <td className="admin-statement">{q.statement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function FeedbackPanel() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    adminListFeedback()
      .then(setItems)
      .catch((e) => setError(e.message));
  }, []);

  const toggle = async (fb) => {
    try {
      const updated = await adminSetFeedbackResolved(fb.uuid, !fb.resolved);
      setItems((list) => list.map((x) => (x.uuid === fb.uuid ? updated : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="error" role="alert">{error}</div>;
  if (!items) return <div className="loading" role="status" aria-live="polite">Loading reports…</div>;

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
            className="link-btn"
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
                {fb.page ? ` · ${fb.page}` : ''} ·{' '}
                {new Date(fb.created_at + 'Z').toLocaleString()}
              </p>
              <p className="feedback-content">{fb.content}</p>
              <button className="link-btn" onClick={() => toggle(fb)}>
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
            className="link-btn"
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

export default function AdminPage() {
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
        if (d.tables.length > 0) setSelected(d.tables[0]);
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
    <div className="admin-page">
      <div className="panel">
        <h2 className="panel-title">Message users</h2>
        <AdminMessagePanel />
      </div>

      <div className="panel">
        <h2 className="panel-title">Bug reports and feature requests</h2>
        <FeedbackPanel />
      </div>

      <div className="panel">
        <h2 className="panel-title">Feature introductions</h2>
        <FeatureStatesPanel />
      </div>

      <div className="panel">
        <h2 className="panel-title">Admin</h2>
        <p className="panel-note">Direct database access — no validation.</p>

        <div className="admin-tabs">
          {tables.map((t) => (
            <button
              key={t}
              className={t === selected ? 'admin-tab active' : 'admin-tab'}
              onClick={() => setSelected(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="success">{notice}</div>}

        {!data ? (
          <div className="loading" role="status" aria-live="polite">Loading {selected}…</div>
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
                        className="danger-link"
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
        <h6 className="mini-title">SQL console</h6>
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

      <div className="panel">
        <h6 className="mini-title">Database metrics</h6>
        <DbMetricsPanel />
      </div>
    </div>
  );
}
