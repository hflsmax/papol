import React, { useState, useEffect } from 'react';
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
} from '../api';

function DbMetricsPanel() {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  const load = (promise) =>
    promise.then(setMetrics).catch((e) => setError(e.message));

  useEffect(() => {
    load(adminDbMetrics());
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!metrics) return <div className="loading">Loading metrics…</div>;

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
      const updated = await adminSetFeedbackResolved(fb.id, !fb.resolved);
      setItems((list) => list.map((x) => (x.id === fb.id ? updated : x)));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!items) return <div className="loading">Loading reports…</div>;

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
              key={fb.id}
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

export default function AdminPage() {
  const [tables, setTables] = useState([]);
  const [selected, setSelected] = useState(null);
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
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
    if (selected) loadTable(selected);
  }, [selected]);

  if (error && !data) return <div className="error">{error}</div>;

  const pkName = data?.primary_key?.[0];

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
    if (!confirm(`Delete row ${pk} from ${selected}?`)) return;
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
        <h2 className="panel-title">Bug reports and feature requests</h2>
        <FeedbackPanel />
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

        {error && <div className="error">{error}</div>}
        {notice && <div className="success">{notice}</div>}

        {!data ? (
          <div className="loading">Loading {selected}…</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c}>
                      {c}
                      {c === pkName ? ' 🔑' : ''}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
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
          placeholder="e.g. UPDATE papers SET year = 2025 WHERE id = 3;  (also use for INSERTs)"
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
