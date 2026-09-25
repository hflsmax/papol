import React, { useEffect, useRef, useState } from 'react';
import { getPaperActivity } from '../../../shared/api/activity.js';
import { useDismiss } from '../../../shared/useDismiss.js';
import { Working } from '../../../shared/ui/Waiting.js';
import { appPath } from '../base';
import {
  clockTime, dayName, daysOf, EFFORT_MARKS, effortLevel, effortRange, formatDuration, lastWhen,
  recentWeeks, shadeOf,
} from '../activityView';

const LEVELS = EFFORT_MARKS.length;

// The five levels in a row, this paper's ringed: the key to the colour
// its line in the nook wears.
function LevelKey({ level }) {
  return (
    <div className="effort-levels">
      <span className="effort-levels-scale" aria-hidden="true">
        {Array.from({ length: LEVELS }, (_, i) => (
          <i key={i} className={`effort-level-${i + 1}${i + 1 === level ? ' is-current' : ''}`} title={effortRange(i + 1)} />
        ))}
      </span>
      <span>Level {level} of {LEVELS} · {effortRange(level)}</span>
    </div>
  );
}

const WEEKS = 12;
const DAYS_LISTED = 5;

// The time a user has spent on one paper, from the clock on its line in
// their nook: the whole of it, the last weeks as a small calendar shaded
// as My activity's month is, and the latest days one by one.
function EffortDetail({ subject, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    getPaperActivity(subject)
      .then((answer) => { if (active) setData(answer); })
      .catch((failure) => { if (active) setError(failure.message || 'Could not load the time spent.'); });
    return () => { active = false; };
  }, [subject]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <Working label="Loading…" />;

  const days = daysOf(data.spans);
  const weeks = recentWeeks(data.spans, WEEKS);
  const busy = weeks.filter((d) => d.seconds > 0).length;
  const since = data.first_at ? new Date(data.first_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <>
      <div className="effort-pop-head">
        <p className="kicker">Time reading this paper</p>
        <button type="button" className="effort-pop-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="effort-pop-total">{formatDuration(data.seconds)}</p>
      <LevelKey level={effortLevel(data.seconds)} />
      {since && <p className="effort-pop-note">Since {since}, last {lastWhen(data.last_at)}</p>}

      <div
        className="effort-weeks"
        role="img"
        aria-label={`Read on ${busy} ${busy === 1 ? 'day' : 'days'} in the last ${WEEKS} weeks`}
      >
        {weeks.map(({ day, seconds }) => (
          <i
            key={+day}
            className={seconds == null ? 'is-future' : `activity-shade-${shadeOf(seconds)}`}
            title={seconds == null ? undefined : `${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${seconds > 0 ? formatDuration(seconds) : 'not read'}`}
          />
        ))}
      </div>
      <p className="effort-pop-note">Last {WEEKS} weeks · a column a week, Monday at the top</p>

      {days.length > 0 && (
        <>
          <p className="kicker effort-pop-days-title">Latest days</p>
          <ol className="effort-pop-days">
            {days.slice(0, DAYS_LISTED).map((entry) => (
              <li key={+entry.day}>
                <span>{dayName(entry.day)}</span>
                <span className="effort-pop-when">{clockTime(entry.first)}–{clockTime(entry.last)}</span>
                <span className="effort-pop-time">{formatDuration(entry.seconds)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <a className="effort-pop-link" href={appPath('/profile')}>See it in My activity</a>
    </>
  );
}

// The clock and the time on a paper's line in its user's nook, which
// opens the detail.
export default function Effort({ effort, subject }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  useDismiss(open, anchor, () => setOpen(false));
  if (!(effort?.seconds > 0)) return null;
  const level = effortLevel(effort.seconds);
  const said = `Read for ${formatDuration(effort.seconds)}, last ${lastWhen(effort.last_at)}. Effort level ${level} of ${LEVELS}, ${effortRange(level)}`;
  return (
    <span className="nook-effort-anchor" ref={anchor}>
      <button
        type="button"
        className={`nook-effort effort-level-${level}`}
        title={`${said}. Only you see this.`}
        aria-label={`${said}. Show the time spent`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={(event) => { event.stopPropagation(); setOpen(!open); }}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.75" /><path d="M6 3.4V6l1.8 1.2" /></svg>
        {formatDuration(effort.seconds)}
      </button>
      {open && (
        <div className="effort-pop" role="dialog" aria-label="Time reading this paper" onClick={(event) => event.stopPropagation()}>
          <EffortDetail subject={subject} onClose={() => setOpen(false)} />
        </div>
      )}
    </span>
  );
}
