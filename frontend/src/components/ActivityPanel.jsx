import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActivity } from '../../../shared/api/activity.js';
import { flushActivity } from '../../../shared/activity.js';
import { paperHref } from '../../../shared/api/papers.js';
import { Working } from '../../../shared/ui/Waiting.js';
import {
  blocksOfDay, clockTime, coloursFor, dailyBySubject, formatDuration, formatDurationShort, ownDays, papersWithin,
  periodLabel, periodOf, secondsIn, shadeOf, SHADE_MARKS, stepPeriod, VIEWS,
} from '../activityView';

const VIEW_LABELS = { day: 'Day', week: 'Week', month: 'Month' };
const STEP_NAMES = { day: 'day', week: 'week', month: 'month' };
const HOUR_TICKS = [0, 6, 12, 18, 24];
const LISTED = 8;
const VIEW_KEY = 'papol.activity.view';
// A week or month, shown as its total through the days, or paper by paper.
const SPLIT_KEY = 'papol.activity.split';
const SPLITS = [['total', 'Total'], ['paper', 'By paper']];

function storedView() {
  try { return VIEWS.includes(localStorage.getItem(VIEW_KEY)) ? localStorage.getItem(VIEW_KEY) : 'week'; }
  catch { return 'week'; }
}

function storedSplit() {
  try { return localStorage.getItem(SPLIT_KEY) === 'paper' ? 'paper' : 'total'; }
  catch { return 'total'; }
}

function hourLabel(hour) {
  return new Date(2000, 0, 1, hour % 24).toLocaleTimeString(undefined, { hour: 'numeric' });
}

function paperOf(data, sha256) {
  const paper = data.papers[sha256];
  return { name: paper?.title || 'A paper no longer in Papol', href: paper ? paperHref({ sha256 }) : null };
}

// The hours of a day under a timeline, and the faint lines they stand for.
function HourAxis() {
  return (
    <div className="activity-axis" aria-hidden="true">
      {HOUR_TICKS.map((hour) => (
        <span key={hour} style={{ left: `${(hour / 24) * 100}%` }}>{hourLabel(hour)}</span>
      ))}
    </div>
  );
}

function Gridlines() {
  return HOUR_TICKS.slice(1, -1).map((hour) => (
    <i key={hour} className="activity-gridline" style={{ left: `${(hour / 24) * 100}%` }} aria-hidden="true" />
  ));
}

// One day across the width of its track: a block for each span, where it
// was, as long as it was, in its paper's colour. Each is a link to the
// paper. `paint` is the period's colours and which paper, if any, is
// picked out.
function Track({ blocks, data, paint, onTip, now = null, label }) {
  return (
    <div className="activity-track" role="group" aria-label={label}>
      <Gridlines />
      {now != null && <i className="activity-now" style={{ left: `${now * 100}%` }} aria-hidden="true" />}
      {blocks.map((block, i) => {
        const subject = paperOf(data, block.subject);
        const when = `${clockTime(block.started)}–${clockTime(block.ended)}`;
        const key = block.subject;
        const tip = { title: subject.name, lines: [when, formatDuration(block.seconds)] };
        const faded = paint.focus != null && paint.focus !== key;
        const Tag = subject.href ? 'a' : 'span';
        return (
          <Tag
            key={i}
            href={subject.href || undefined}
            tabIndex={subject.href ? undefined : 0}
            className={`activity-block activity-${paint.colours.get(key) ?? 'other'}${faded ? ' is-faded' : ''}`}
            style={{ left: `${block.left * 100}%`, width: `${block.width * 100}%` }}
            aria-label={`${subject.name}, ${when}, ${formatDuration(block.seconds)}`}
            onMouseEnter={(event) => { onTip(event, tip); paint.pick(key); }}
            onFocus={(event) => { onTip(event, tip); paint.pick(key); }}
            onMouseLeave={() => { onTip(null); paint.pick(null); }}
            onBlur={() => { onTip(null); paint.pick(null); }}
          />
        );
      })}
    </div>
  );
}

function DayChart({ period, spans, data, paint, onTip }) {
  const seconds = secondsIn(spans, period.start, period.end);
  const at = Date.now();
  const now = at >= +period.start && at < +period.end ? (at - period.start) / (period.end - period.start) : null;
  const name = period.start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return (
    <div className="activity-chart activity-day">
      <div className="activity-row">
        <span className="activity-row-label">{name}</span>
        <Track blocks={blocksOfDay(spans, period.start)} data={data} paint={paint} onTip={onTip} now={now} label="Reading through the day" />
        <span className="activity-row-total">{seconds > 0 ? formatDurationShort(seconds) : ''}</span>
      </div>
      <div className="activity-row activity-axis-row">
        <span />
        <HourAxis />
        <span />
      </div>
    </div>
  );
}

function WeekChart({ period, spans, data, paint, onTip, onOpenDay }) {
  const today = new Date().toDateString();
  return (
    <div className="activity-chart activity-week">
      {period.days.map((day) => {
        const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
        const total = secondsIn(spans, day, next);
        const name = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
        return (
          <div key={+day} className={day.toDateString() === today ? 'activity-row is-today' : 'activity-row'}>
            <button type="button" className="activity-row-label activity-day-link" onClick={() => onOpenDay(day)}
              aria-label={`Open ${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}>
              {name}
            </button>
            <Track blocks={blocksOfDay(spans, day)} data={data} paint={paint} onTip={onTip} label={name} />
            <span className="activity-row-total">{total > 0 ? formatDurationShort(total) : ''}</span>
          </div>
        );
      })}
      <div className="activity-row activity-axis-row">
        <span />
        <HourAxis />
        <span />
      </div>
    </div>
  );
}

function MonthChart({ period, spans, onTip, onOpenDay }) {
  const weekdays = period.days.slice(0, 7).map((day) => day.toLocaleDateString(undefined, { weekday: 'narrow' }));
  const today = new Date().toDateString();
  return (
    <div className="activity-chart activity-month">
      <div className="activity-calendar" role="group" aria-label={periodLabel(period)}>
        {weekdays.map((name, i) => <span key={i} className="activity-weekday" aria-hidden="true">{name}</span>)}
        {period.days.map((day) => {
          const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
          const seconds = secondsIn(spans, day, next);
          const outside = day < period.start || day >= period.end;
          const long = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
          const tip = { title: long, lines: [seconds > 0 ? formatDuration(seconds) : 'Nothing read'] };
          return (
            <button
              key={+day}
              type="button"
              className={[
                'activity-cell', `activity-shade-${shadeOf(seconds)}`,
                outside ? 'is-outside' : '', day.toDateString() === today ? 'is-today' : '',
              ].filter(Boolean).join(' ')}
              aria-label={`${long}: ${seconds > 0 ? formatDuration(seconds) : 'nothing read'}`}
              onClick={() => onOpenDay(day)}
              onMouseEnter={(event) => onTip(event, tip)}
              onFocus={(event) => onTip(event, tip)}
              onMouseLeave={() => onTip(null)}
              onBlur={() => onTip(null)}
            >
              <span className="activity-cell-day">{day.getDate()}</span>
              {seconds > 0 && <span className="activity-cell-total">{formatDurationShort(seconds)}</span>}
            </button>
          );
        })}
      </div>
      <div className="activity-scale" aria-hidden="true">
        <span>Less</span>
        {[1, 2, 3, 4, 5].map((step) => (
          <i key={step} className={`activity-shade-${step}`} title={step === 1 ? 'Under 15 min' : `${formatDuration(SHADE_MARKS[step - 1])} or more`} />
        ))}
        <span>4 h or more</span>
      </div>
    </div>
  );
}

// A week or a month paper by paper: a row to each paper, most time first, and in each a column to each day, all on one scale, so a
// paper's days read along its row and two papers compare down the page.
// A column opens its day.
function PaperRows({ period, spans, papers, data, paint, onTip, onOpenDay }) {
  const [all, setAll] = useState(false);
  const days = ownDays(period);
  const { rows, most } = dailyBySubject(spans, days);
  const shown = all ? papers : papers.slice(0, LISTED);
  const week = period.view === 'week';
  const dayLabel = (day) => (week
    ? day.toLocaleDateString(undefined, { weekday: 'short' })
    : (day.getDate() === 1 || day.getDay() === 1 ? String(day.getDate()) : ''));
  return (
    <div className={`activity-chart activity-papers${week ? ' is-week' : ' is-month'}`} style={{ '--activity-days': days.length }}>
      <div className="activity-paper-row activity-papers-head" aria-hidden="true">
        <span />
        <div className="activity-columns">
          {days.map((day) => <span key={+day}>{dayLabel(day)}</span>)}
        </div>
        <span />
      </div>
      {shown.map((entry) => {
        const key = entry.subject;
        const subject = paperOf(data, key);
        const colour = paint.colours.get(key) ?? 'other';
        const faded = paint.focus != null && paint.focus !== key;
        const row = rows.get(key) ?? [];
        return (
          <div
            key={key}
            className={`activity-paper-row${faded ? ' is-faded' : ''}`}
            onMouseEnter={() => paint.pick(key)}
            onMouseLeave={() => paint.pick(null)}
          >
            <span className="activity-paper-name">
              <span className={`activity-swatch activity-${colour}`} aria-hidden="true" />
              {subject.href ? <a href={subject.href}>{subject.name}</a> : <span className="activity-subject-gone">{subject.name}</span>}
            </span>
            <div className="activity-columns" role="group" aria-label={subject.name}>
              {days.map((day, i) => {
                const seconds = row[i] ?? 0;
                const long = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
                const tip = { title: subject.name, lines: [long, seconds > 0 ? formatDuration(seconds) : 'Nothing'] };
                return (
                  <button
                    key={+day}
                    type="button"
                    className="activity-column"
                    aria-label={`${long}: ${seconds > 0 ? formatDuration(seconds) : 'nothing'}`}
                    onClick={() => onOpenDay(day)}
                    onMouseEnter={(event) => onTip(event, tip)}
                    onFocus={(event) => { onTip(event, tip); paint.pick(key); }}
                    onMouseLeave={() => onTip(null)}
                    onBlur={() => { onTip(null); paint.pick(null); }}
                  >
                    {seconds > 0 && <i className={`activity-${colour}`} style={{ height: `${Math.max(8, (seconds / most) * 100)}%` }} />}
                  </button>
                );
              })}
            </div>
            <span className="activity-row-total">{formatDurationShort(entry.seconds)}</span>
          </div>
        );
      })}
      <p className="activity-papers-note">
        One scale for every row: the tallest column is {formatDuration(most)} in a day.
        {papers.length > LISTED && (
          <button type="button" className="activity-more" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${papers.length}`}
          </button>
        )}
      </p>
    </div>
  );
}

// The papers read in the period, most time first, each in the colour its
// blocks wear, so the list is also the key to them. Hovering or focusing
// a line picks its time out on the chart above.
function Papers({ papers, data, paint }) {
  const [all, setAll] = useState(false);
  if (!papers.length) return null;
  const most = papers[0].seconds;
  const shown = all ? papers : papers.slice(0, LISTED);
  return (
    <div className="activity-subjects">
      <h3 className="kicker">Papers</h3>
      <ol>
        {shown.map((entry) => {
          const key = entry.subject;
          const subject = paperOf(data, key);
          const colour = paint.colours.get(key) ?? 'other';
          const faded = paint.focus != null && paint.focus !== key;
          return (
            <li
              key={key}
              className={faded ? 'is-faded' : undefined}
              onMouseEnter={() => paint.pick(key)}
              onMouseLeave={() => paint.pick(null)}
              onFocus={() => paint.pick(key)}
              onBlur={() => paint.pick(null)}
            >
              <span className={`activity-swatch activity-${colour}`} aria-hidden="true" />
              {subject.href ? <a href={subject.href}>{subject.name}</a> : <span className="activity-subject-gone">{subject.name}</span>}
              <span className="activity-subject-bar" aria-hidden="true">
                <i className={`activity-${colour}`} style={{ width: `${Math.max(2, (entry.seconds / most) * 100)}%` }} />
              </span>
              <span className="activity-subject-time">{formatDuration(entry.seconds)}</span>
            </li>
          );
        })}
      </ol>
      {papers.length > LISTED && (
        <button type="button" className="activity-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${papers.length}`}
        </button>
      )}
    </div>
  );
}

export default function ActivityPanel() {
  const [view, setView] = useState(storedView);
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tip, setTip] = useState(null);
  const [focus, setFocus] = useState(null);
  const [split, setSplit] = useState(storedSplit);
  const chartRef = useRef(null);
  const period = useMemo(() => periodOf(view, anchor), [view, anchor]);

  useEffect(() => {
    let active = true;
    setError(null);
    setFocus(null);
    flushActivity()
      .then(() => getActivity(period.from, period.to))
      .then((answer) => { if (active) setData({ ...answer, key: +period.from }); })
      .catch((failure) => { if (active) setError(failure.message || 'Your activity could not be loaded.'); });
    return () => { active = false; };
  }, [period]);

  const choose = (next) => {
    setView(next);
    setTip(null);
    setFocus(null);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* only remembered */ }
  };
  const openDay = (day) => { setAnchor(day); choose('day'); };
  const chooseSplit = (next) => {
    setSplit(next);
    setTip(null);
    setFocus(null);
    try { localStorage.setItem(SPLIT_KEY, next); } catch { /* only remembered */ }
  };
  const byPaper = split === 'paper' && view !== 'day';
  const showTip = (event, content) => {
    if (!event || !chartRef.current) { setTip(null); return; }
    const box = chartRef.current.getBoundingClientRect(), mark = event.currentTarget.getBoundingClientRect();
    setTip({ ...content, x: mark.left + mark.width / 2 - box.left, y: mark.top - box.top });
  };

  const now = new Date();
  const atPresent = period.end > now;
  const first = data?.first_at ? new Date(data.first_at) : null;
  const atBeginning = !first || period.start <= first;
  const loaded = data && data.key === +period.from;
  const spans = loaded ? data.spans : [];
  const seconds = secondsIn(spans, period.start, period.end);
  const papers = loaded ? papersWithin(spans, period.start, period.end) : [];
  const paint = { colours: coloursFor(papers), focus, pick: setFocus };

  return (
    <section className="panel activity-panel" aria-labelledby="activity-title">
      <div className="panel-head-row">
        <h2 className="panel-title" id="activity-title">My activity</h2>
        <div className="activity-views" role="group" aria-label="Show a">
          {VIEWS.map((name) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => choose(name)}>{VIEW_LABELS[name]}</button>
          ))}
        </div>
      </div>

      <div className="activity-period">
        <button type="button" className="activity-step" onClick={() => setAnchor(stepPeriod(view, period.start, -1))}
          disabled={atBeginning} aria-label={`Previous ${STEP_NAMES[view]}`}>‹</button>
        <h3 className="activity-period-label" aria-live="polite">{periodLabel(period)}</h3>
        <button type="button" className="activity-step" onClick={() => setAnchor(stepPeriod(view, period.start, 1))}
          disabled={atPresent} aria-label={`Next ${STEP_NAMES[view]}`}>›</button>
        <span className="activity-period-tools">
          {!atPresent && <button type="button" className="activity-today" onClick={() => setAnchor(new Date())}>Today</button>}
          {view !== 'day' && (
            <span className="activity-views activity-split" role="group" aria-label="Show the time">
              {SPLITS.map(([name, label]) => (
                <button key={name} type="button" aria-pressed={split === name} onClick={() => chooseSplit(name)}>{label}</button>
              ))}
            </span>
          )}
        </span>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {!error && !loaded && <div className="loading"><Working label="Loading activity…" /></div>}
      {!error && loaded && (
        <>
          {seconds > 0 && (
            <p className="activity-total">
              <strong>{formatDuration(seconds)}</strong> reading {papers.length} {papers.length === 1 ? 'paper' : 'papers'}
            </p>
          )}

          <div className="activity-figure" ref={chartRef} onMouseLeave={() => setTip(null)}>
            {view === 'day' && <DayChart period={period} spans={spans} data={data} paint={paint} onTip={showTip} />}
            {byPaper && seconds > 0 && (
              <PaperRows period={period} spans={spans} papers={papers} data={data} paint={paint} onTip={showTip} onOpenDay={openDay} />
            )}
            {view === 'week' && !byPaper && <WeekChart period={period} spans={spans} data={data} paint={paint} onTip={showTip} onOpenDay={openDay} />}
            {view === 'month' && !byPaper && <MonthChart period={period} spans={spans} onTip={showTip} onOpenDay={openDay} />}
            {tip && (
              <div className="activity-tip" aria-hidden="true" style={{ left: tip.x, top: tip.y }}>
                <strong>{tip.title}</strong>
                {tip.lines.map((line) => <span key={line}>{line}</span>)}
              </div>
            )}
          </div>

          {seconds > 0
            ? !byPaper && <Papers key={+period.from + view} papers={papers} data={data} paint={paint} />
            : (
              <p className="activity-empty">Nothing read this {STEP_NAMES[view]}.</p>
            )}
        </>
      )}
    </section>
  );
}
