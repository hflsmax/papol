import React, { useState, useEffect } from 'react';
import {
  adminListTables,
  adminGetTable,
  adminUpdateRow,
  adminDeleteRow,
  adminRunSql,
  adminDbMetrics,
  adminResetDbMetrics,
  adminActiveUsers,
  adminConcurrencySeries,
  adminListFeedback,
  adminSetFeedbackResolved,
} from '../api';

function ConcurrencyChart({ points }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const width = 900;
  const height = 220;
  const pad = { top: 14, right: 12, bottom: 30, left: 34 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maximum = Math.max(1, ...points.map((point) => point.count));
  const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = (count) => pad.top + plotHeight - (count / maximum) * plotHeight;
  const line = points.map((point, index) => `${x(index)},${y(point.count)}`).join(' ');
  const ticks = [0, 6, 12, 18, 24].map((hours) => {
    const index = Math.min(points.length - 1, Math.round(hours * 12));
    return { index, label: new Date(`${points[index].at}Z`).toLocaleTimeString([], {
      hour: 'numeric', minute: '2-digit',
    }) };
  });
  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeReaders = activePoint?.readers || [];
  const visibleReaders = activeReaders.slice(0, 7);
  const tooltipWidth = 220;
  const tooltipHeight = 52 + visibleReaders.length * 17
    + (activeReaders.length > visibleReaders.length ? 17 : 0);
  const tooltipX = activeIndex === null
    ? 0
    : Math.min(width - pad.right - tooltipWidth, Math.max(pad.left, x(activeIndex) + 12));
  const tooltipY = activePoint
    ? Math.max(pad.top, Math.min(height - pad.bottom - tooltipHeight, y(activePoint.count) - tooltipHeight / 2))
    : 0;

  const selectNearestPoint = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const index = Math.round(((svgX - pad.left) / plotWidth) * (points.length - 1));
    setActiveIndex(Math.max(0, Math.min(points.length - 1, index)));
  };

  const inspectWithKeyboard = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') return setActiveIndex(0);
    if (event.key === 'End') return setActiveIndex(points.length - 1);
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    setActiveIndex((current) => Math.max(0, Math.min(
      points.length - 1,
      (current ?? points.length - 1) + direction,
    )));
  };

  return (
    <div className="concurrency-chart-wrap">
      <svg
        className="concurrency-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Concurrent readers over the last 24 hours"
        tabIndex="0"
        onPointerMove={selectNearestPoint}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((current) => current ?? points.length - 1)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={inspectWithKeyboard}
      >
        {[0, maximum].map((value) => (
          <g key={value}>
            <line x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
            <text x={pad.left - 8} y={y(value) + 4} textAnchor="end">{value}</text>
          </g>
        ))}
        <polygon
          className="concurrency-area"
          points={`${pad.left},${y(0)} ${line} ${width - pad.right},${y(0)}`}
        />
        <polyline className="concurrency-line" points={line} />
        {activePoint && (
          <g className="concurrency-inspector" aria-live="polite">
            <line
              className="concurrency-guide"
              x1={x(activeIndex)} x2={x(activeIndex)}
              y1={pad.top} y2={y(0)}
            />
            <circle cx={x(activeIndex)} cy={y(activePoint.count)} r="4" />
            <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="6" />
            <text className="concurrency-tooltip-time" x={tooltipX + 12} y={tooltipY + 19}>
              {new Date(`${activePoint.at}Z`).toLocaleString([], {
                hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric',
              })}
            </text>
            <text x={tooltipX + 12} y={tooltipY + 38}>
              {activePoint.count} {activePoint.count === 1 ? 'reader' : 'readers'} online
            </text>
            {visibleReaders.map((reader, index) => (
              <text key={`${reader}-${index}`} x={tooltipX + 12} y={tooltipY + 57 + index * 17}>• {reader}</text>
            ))}
            {activeReaders.length > visibleReaders.length && (
              <text x={tooltipX + 12} y={tooltipY + 57 + visibleReaders.length * 17}>
                +{activeReaders.length - visibleReaders.length} more
              </text>
            )}
          </g>
        )}
        {ticks.map((tick) => (
          <text
            key={tick.index}
            x={x(tick.index)}
            y={height - 7}
            textAnchor={tick.index === 0 ? 'start' : tick.index === points.length - 1 ? 'end' : 'middle'}
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ActiveUsersPanel() {
  const [presence, setPresence] = useState(null);
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([adminActiveUsers(), adminConcurrencySeries()])
        .then(([data, history]) => {
          if (alive) {
            setPresence(data);
            setSeries(history);
            setError(null);
          }
        })
        .catch((e) => alive && setError(e.message));
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (error && !presence) return <div className="error">{error}</div>;
  if (!presence) return <div className="loading">Loading active readers…</div>;

  return (
    <>
      <p className="active-user-count">
        <span>{presence.count}</span>{' '}
        concurrent {presence.count === 1 ? 'reader' : 'readers'}
      </p>
      <p className="panel-note">
        Signed-in readers seen in the last {presence.window_seconds / 60} minutes.
        Updates every 30 seconds.
      </p>
      {series?.points?.length > 0 && (
        <>
          <h6 className="mini-title concurrency-title">Last 24 hours</h6>
          <ConcurrencyChart points={series.points} />
        </>
      )}
      {error && <div className="error">{error}</div>}
      {presence.users.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>reader</th>
                <th>email</th>
                <th>last seen</th>
                <th>sessions</th>
              </tr>
            </thead>
            <tbody>
              {presence.users.map((reader) => (
                <tr key={reader.id}>
                  <td>{reader.display_name}</td>
                  <td>{reader.email}</td>
                  <td>{new Date(`${reader.last_seen_at}Z`).toLocaleTimeString()}</td>
                  <td>{reader.session_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
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
        <h2 className="panel-title">Concurrent readers</h2>
        <ActiveUsersPanel />
      </div>

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
