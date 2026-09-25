import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActivity } from '../../../shared/api/activity.js';
import { flushActivity } from '../../../shared/activity.js';
import { paperHref } from '../../../shared/api/papers.js';
import { Working } from '../../../shared/ui/Waiting.js';
import { appPath } from '../base';
import {
  blocksOfDay, clockTime, coloursFor, dailyBySubject, formatDuration, ownDays, formatDurationShort, KINDS, periodLabel, periodOf,
  shadeOf, SHADE_MARKS, stepPeriod, subjectsWithin, totalsWithin, VIEWS,
} from '../activityView';

const VIEW_LABELS = { day: 'Day', week: 'Week', month: 'Month' };
const KIND_LABELS = { reading: 'Reading', board: 'Boards' };
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

function subjectOf(data, kind, subject) {
  if (kind === 'reading') {
    const paper = data.papers[subject];
    return { name: paper?.title || 'A paper no longer in Papol', href: paper ? paperHref({ sha256: subject }) : null };
  }
  const board = data.boards[subject];
  if (!board) return { name: 'A board no longer in Papol', href: null };
  return { name: board.deleted ? `${board.name} (deleted)` : board.name, href: board.deleted ? null : appPath(`/board/${subject}`) };
}

// A tile's amount, said in full, or in its short form where the tile is
// too narrow for the full one (the stylesheet shows one of the two).
function Amount({ seconds }) {
  return (
    <>
      <span className="activity-long">{formatDuration(seconds)}</span>
      <span className="activity-short" aria-hidden="true">{formatDurationShort(seconds)}</span>
    </>
  );
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
// was, as long as it was. Each is a link to what the time was spent on.
// `paint` is the period's colours and which paper, if any, is picked out.
function Track({ blocks, data, paint, onTip, lane = null, now = null, label }) {
  return (
    <div className="activity-track" role="group" aria-label={label}>
      <Gridlines />
      {now != null && <i className="activity-now" style={{ left: `${now * 100}%` }} aria-hidden="true" />}
      {blocks.filter((b) => lane == null || b.kind === lane).map((block, i) => {
        const subject = subjectOf(data, block.kind, block.subject);
        const when = `${clockTime(block.started)}–${clockTime(block.ended)}`;
        const key = `${block.kind}:${block.subject}`;
        const tip = { title: subject.name, lines: [`${block.kind === 'board' ? 'Board' : 'Reading'} · ${when}`, formatDuration(block.seconds)] };
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
  const blocks = blocksOfDay(spans, period.start);
  const totals = totalsWithin(spans, period.start, period.end);
  const at = Date.now();
  const now = at >= +period.start && at < +period.end ? (at - period.start) / (period.end - period.start) : null;
  return (
    <div className="activity-chart activity-day">
      {KINDS.map((kind) => (
        <div key={kind} className="activity-row">
          <span className="activity-row-label">{KIND_LABELS[kind]}</span>
          <Track blocks={blocks} lane={kind} data={data} paint={paint} onTip={onTip} now={now} label={`${KIND_LABELS[kind]} through the day`} />
          <span className="activity-row-total">{totals[kind] > 0 ? formatDurationShort(totals[kind]) : ''}</span>
        </div>
      ))}
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
        const total = totalsWithin(spans, day, next).all;
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
          const totals = totalsWithin(spans, day, next);
          const outside = day < period.start || day >= period.end;
          const long = day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
          const tip = { title: long, lines: totals.all > 0
            ? [`${formatDuration(totals.all)} in all`, ...KINDS.filter((k) => totals[k] > 0).map((k) => `${KIND_LABELS[k]} · ${formatDuration(totals[k])}`)]
            : ['Nothing recorded'] };
          return (
            <button
              key={+day}
              type="button"
              className={[
                'activity-cell', `activity-shade-${shadeOf(totals.all)}`,
                outside ? 'is-outside' : '', day.toDateString() === today ? 'is-today' : '',
              ].filter(Boolean).join(' ')}
              aria-label={`${long}: ${totals.all > 0 ? formatDuration(totals.all) : 'nothing recorded'}`}
              onClick={() => onOpenDay(day)}
              onMouseEnter={(event) => onTip(event, tip)}
              onFocus={(event) => onTip(event, tip)}
              onMouseLeave={() => onTip(null)}
              onBlur={() => onTip(null)}
            >
              <span className="activity-cell-day">{day.getDate()}</span>
              {totals.all > 0 && <span className="activity-cell-total">{formatDurationShort(totals.all)}</span>}
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

// A week or a month paper by paper: a row to each paper and board, most
// time first, and in each a column to each day, all on one scale, so a
// paper's days read along its row and two papers compare down the page.
// A column opens its day.
function PaperRows({ period, spans, subjects, data, paint, onTip, onOpenDay }) {
  const [all, setAll] = useState(false);
  const days = ownDays(period);
  const { rows, most } = dailyBySubject(spans, days);
  const shown = all ? subjects : subjects.slice(0, LISTED);
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
        const key = `${entry.kind}:${entry.subject}`;
        const subject = subjectOf(data, entry.kind, entry.subject);
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
        {subjects.length > LISTED && (
          <button type="button" className="activity-more" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${subjects.length}`}
          </button>
        )}
      </p>
    </div>
  );
}

// Where the time in the period went: each paper and board, most first,
// with a bar against the one that took the most.
// Where the time in the period went: each paper and board, most first,
// in the colour its blocks wear, so the list is also the key to them.
// Hovering or focusing a line picks its time out on the chart above.
function Subjects({ subjects, data, paint }) {
  const [all, setAll] = useState(false);
  if (!subjects.length) return null;
  const most = subjects[0].seconds;
  const shown = all ? subjects : subjects.slice(0, LISTED);
  return (
    <div className="activity-subjects">
      <h3 className="kicker">Where the time went</h3>
      <ol>
        {shown.map((entry) => {
          const subject = subjectOf(data, entry.kind, entry.subject);
          const key = `${entry.kind}:${entry.subject}`;
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
              <span className={`activity-swatch activity-${colour}`} aria-label={entry.kind === 'board' ? 'Board' : 'Paper'} role="img" />
              {subject.href ? <a href={subject.href}>{subject.name}</a> : <span className="activity-subject-gone">{subject.name}</span>}
              <span className="activity-subject-bar" aria-hidden="true">
                <i className={`activity-${colour}`} style={{ width: `${Math.max(2, (entry.seconds / most) * 100)}%` }} />
              </span>
              <span className="activity-subject-time">{formatDuration(entry.seconds)}</span>
            </li>
          );
        })}
      </ol>
      {subjects.length > LISTED && (
        <button type="button" className="activity-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${subjects.length}`}
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
  const totals = totalsWithin(spans, period.start, period.end);
  const subjects = loaded ? subjectsWithin(spans, period.start, period.end) : [];
  const paint = { colours: coloursFor(subjects), focus, pick: setFocus };
  const papers = subjects.filter((s) => s.kind === 'reading').length, boards = subjects.length - papers;
  const counted = [papers && `${papers} ${papers === 1 ? 'paper' : 'papers'}`, boards && `${boards} ${boards === 1 ? 'board' : 'boards'}`].filter(Boolean).join(' and ');

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
      <p className="panel-note">
        Only you see this. Time runs from one use of a paper or board to the next — a scroll, a key, the
        pointer — and a pause of up to ten minutes between them counts, whether you sat over a page or
        looked something up in another tab, unless you spent it on another paper in Papol.
      </p>

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
          <dl className="activity-tiles">
            <div className="activity-tile">
              <dt>In all</dt>
              <dd><Amount seconds={totals.all} /></dd>
              <dd className="activity-tile-note">{counted || 'Nothing yet'}</dd>
            </div>
            {KINDS.map((kind) => (
              <div key={kind} className="activity-tile">
                <dt>{kind === 'board' && <span className="activity-swatch activity-board" aria-hidden="true" />}{KIND_LABELS[kind]}</dt>
                <dd><Amount seconds={totals[kind]} /></dd>
              </div>
            ))}
          </dl>

          <div className="activity-figure" ref={chartRef} onMouseLeave={() => setTip(null)}>
            {view === 'day' && <DayChart period={period} spans={spans} data={data} paint={paint} onTip={showTip} />}
            {byPaper && totals.all > 0 && (
              <PaperRows period={period} spans={spans} subjects={subjects} data={data} paint={paint} onTip={showTip} onOpenDay={openDay} />
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

          {totals.all > 0
            ? !byPaper && <Subjects key={+period.from + view} subjects={subjects} data={data} paint={paint} />
            : (
              <p className="activity-empty">
                {first
                  ? `Nothing recorded this ${STEP_NAMES[view]}.`
                  : 'Nothing recorded yet. Open a paper or one of your boards, and the time you spend there shows here.'}
              </p>
            )}
        </>
      )}
    </section>
  );
}
