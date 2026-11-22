import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import {
  askToJoinProject, getRoom, markRoomSeen,
} from '../../../shared/api/friends.js';
import { addToNook } from '../../../shared/api/papers.js';
import { paperName } from '../../../shared/paperName.js';
import NewsDot from '../../../shared/ui/NewsDot.jsx';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import Face, { FacesLead } from '../../../shared/ui/Face.jsx';
import { TalkCard, when } from '../../../shared/ui/Talk.jsx';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat';
import { keep, kept } from '../lastMember';
import { useFriends } from '../friendsStore';
import { RatingSummary } from './Rating';

const VIEW_KEY = 'papol.roomView';
const stored = (key, fallback) => {
  try { return window.sessionStorage.getItem(key) || fallback; } catch { return fallback; }
};
const store = (key, value) => {
  try { window.sessionStorage.setItem(key, value); } catch { /* session storage may be off */ }
};

const first = (user) => user?.display_name?.split(' ')[0] ?? 'Someone';
const metaOf = (paper) => [formatAuthors(paper.authors), paper.year, paper.journal].filter(Boolean).join(' · ');

// "Ana, Ben and 3 more": a few names, then how many are left.
function someTitles(papers, shown = 2) {
  const titles = papers.slice(0, shown).map((p) => p.title);
  const rest = papers.length - titles.length;
  return rest > 0 ? `${titles.join(', ')} and ${rest} more` : titles.join(' and ');
}

// Ratings as the dots, only those given.
function Ratings({ ratings }) {
  return (
    <span className="room-ratings">
      <RatingSummary compact paper={{ rating_expertise: ratings.expertise, rating_reading: ratings.reading, rating_liking: ratings.liking }} />
    </span>
  );
}

// What someone did with a paper, in a line: their face, the act, their
// words if they wrote any, and when. A dig or a post in one opens the dig
// right there, to read and to post in.
function Line({ line, title, currentUser }) {
  const [open, setOpen] = useState(false);
  const me = line.user.uuid === currentUser.uuid;
  const whose = line.dig?.owner?.uuid === currentUser.uuid ? 'your' : line.dig?.owner?.uuid === line.user.uuid ? 'their' : `${first(line.dig?.owner)}’s`;
  const place = line.dig?.page ? ` on page ${line.dig.page}` : '';
  const did = line.did === 'added' ? 'added it'
      : line.did === 'thought' ? 'thought'
        : line.did === 'rated' ? 'rated it'
          : line.did === 'dug' ? `dug${place}`
            : line.did === 'posted' ? `posted in ${whose} dig${place}`
              : 'is reading it this week';
  const words = line.words && (
    <span className="room-words">“{line.words}”</span>
  );
  return (
    <li className={`room-line is-${line.did}`}>
      <Face user={line.user} />
      <span className="room-said">
        <b>{me ? 'You' : line.user.display_name}</b> <span className="room-did">{did}</span>
        {/* A reading line says only that it happened this week. */}
        {line.did !== 'reading' && <time dateTime={line.at} title={when(line.at, { time: true })}>{when(line.at)}</time>}
        {line.dig ? (
          <button type="button" className="room-dig-open" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            {words}
            {line.dig.post_count > 0 && <span className="room-posts">{line.dig.post_count} {line.dig.post_count === 1 ? 'post' : 'posts'}</span>}
          </button>
        ) : words}
        {line.ratings && <Ratings ratings={line.ratings} />}
        {open && (
          <TalkCard
            inline single conversation tucked only projectUuid={null} dig={line.dig.uuid}
            subject={`dig:${line.dig.uuid}`} label={title} currentUser={currentUser}
          />
        )}
      </span>
    </li>
  );
}

function Keep({ paper, onKept }) {
  const [state, setState] = useState('idle');
  if (state === 'kept') return <span className="room-kept">In my nook</span>;
  return (
    <button
      type="button" className="room-keep" disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        try { await addToNook(paper.sha256); setState('kept'); onKept?.(); } catch { setState('idle'); }
      }}
    >
      Add to my nook
    </button>
  );
}

function PaperRow({ row, currentUser }) {
  return (
    <li className={`room-row is-paper${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <a className="room-title" href={appPath(`/paper/${paperName(row.paper.sha256)}`)}><PaperTitle title={row.paper.title} /></a>
          {row.is_new && <NewsDot />}
          <p className="room-meta">{metaOf(row.paper)}</p>
        </div>
        {!row.in_my_nook && <Keep paper={row.paper} />}
      </div>
      <ul className="room-lines">
        {row.lines.map((line) => (
          <Line key={`${line.user.uuid}:${line.did}:${line.dig?.uuid ?? ''}`} line={line} title={row.paper.title} currentUser={currentUser} />
        ))}
      </ul>
    </li>
  );
}

// A folder brought in at once: one line, which unfolds to its papers.
function BatchRow({ row }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`room-row is-batch${row.is_new ? ' is-new' : ''}`}>
      <div className="room-line">
        <Face user={row.user} />
        <span className="room-said">
          <button type="button" className="room-batch-open" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            <b>{row.user.display_name}</b> added {row.papers.length} papers
          </button>
          {row.is_new && <NewsDot />}
          <time dateTime={row.at}>{when(row.at)}</time>
          {!open && <span className="room-batch-some">{someTitles(row.papers)}</span>}
        </span>
      </div>
      {open && (
        <ul className="room-batch">
          {row.papers.map((paper) => (
            <li key={paper.sha256}>
              <a className="room-batch-title" href={appPath(`/paper/${paperName(paper.sha256)}`)}><PaperTitle title={paper.title} /></a>
              <span className="room-meta">{metaOf(paper)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function BoardRow({ row }) {
  return (
    <li className={`room-row is-board${row.is_new ? ' is-new' : ''}`}>
      <div className="room-line">
        <Face user={row.user} />
        <span className="room-said">
          <b>{row.user.display_name}</b> <span className="room-did">put a board on a public shelf</span>
          <time dateTime={row.at}>{when(row.at)}</time>
          {row.is_new && <NewsDot />}
          <a className="room-title is-inline" href={appPath(`/board/${row.board.uuid}`)}>{row.board.name}</a>
          <span className="room-meta">{row.board.item_count} {row.board.item_count === 1 ? 'card' : 'cards'}{row.board.description ? ` · ${row.board.description}` : ''}</span>
        </span>
      </div>
    </li>
  );
}

function ProjectRow({ row }) {
  const [asked, setAsked] = useState(row.project.asked);
  const [busy, setBusy] = useState(false);
  const names = row.lines.map((l) => `${l.user.display_name} ${l.did === 'started' ? 'started it' : l.did === 'keeps' ? 'keeps it' : 'joined'}`).join(' · ');
  return (
    <li className={`room-row is-project${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <span className="room-kind">Project</span>
          {row.project.is_member
            ? <a className="room-title" href={appPath(`/project/${row.project.uuid}`)}>{row.project.name}</a>
            : <span className="room-title">{row.project.name}</span>}
          {row.is_new && <NewsDot />}
          <p className="room-meta">
            {names} · {row.project.member_count} {row.project.member_count === 1 ? 'member' : 'members'}
            {row.project.description ? ` · ${row.project.description}` : ''}
          </p>
        </div>
        {!row.project.is_member && (asked ? <span className="room-kept">Asked to join</span> : (
          <button
            type="button" className="room-keep" disabled={busy}
            onClick={async () => { setBusy(true); try { await askToJoinProject(row.project.uuid); setAsked(true); } catch { /* still there to press */ } finally { setBusy(false); } }}
          >
            Ask to join
          </button>
        ))}
      </div>
    </li>
  );
}

function FriendRow({ row }) {
  return (
    <li className={`room-row is-friend${row.is_new ? ' is-new' : ''}`}>
      <div className="room-line">
        <Face user={row.user} />
        <span className="room-said">
          You and <a className="room-person" href={appPath(`/u/${row.user.uuid}`)}>{row.user.display_name}</a> are friends
          <time dateTime={row.at}>{when(row.at)}</time>
          {row.is_new && <NewsDot />}
        </span>
      </div>
    </li>
  );
}

const ROWS = { paper: PaperRow, batch: BatchRow, board: BoardRow, project: ProjectRow, friend: FriendRow };

// The Lounge: what the member's friends are reading and what they
// make of it, a paper to a row, newest first; Everyone is the same room
// made from all of Papol's public news. The room holds four weeks, and ends.
export default function Room({ currentUser, onSeen }) {
  const [view, setView] = useState(() => stored(VIEW_KEY, 'friends'));
  const [room, setRoom] = useState(() => kept(`room:${stored(VIEW_KEY, 'friends')}`));
  const [error, setError] = useState(null);
  const friends = useFriends();
  // The room is marked seen once per visit: what was new when it opened
  // keeps its dot until the member comes back.
  const marked = useRef(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setRoom(kept(`room:${view}`));
    getRoom({ view })
      .then((next) => {
        if (!active) return;
        keep(`room:${view}`, next);
        setRoom(next);
        if (!marked.current) {
          marked.current = true;
          markRoomSeen().then(() => onSeen?.()).catch(() => {});
        }
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
    // Friends made or ended here change who the room is made from.
  }, [view, friends?.friends.length]);

  const choose = (next) => { setView(next); store(VIEW_KEY, next); };
  // With no friends yet the room is everyone's, whatever was chosen.
  const shown = room?.view ?? view;

  return (
    <FacesLead.Provider value>
      <div className="room">
        <div className="room-head">
          <nav className="project-tabs room-views" role="tablist" aria-label="Whose news">
            {[['friends', 'Friends'], ['everyone', 'Everyone']].map(([key, label]) => (
              <button
                key={key} type="button" role="tab" aria-selected={shown === key}
                className={`project-tab${shown === key ? ' is-on' : ''}`} onClick={() => choose(key)}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        {!room && !error && <div className="loading"><Working label="Loading the Lounge…" /></div>}
        {room && (
          <>
            {room.friend_count === 0 && (
              <p className="room-note">
                This is everyone’s public news. Add a friend from their nook and the room becomes theirs:
                what they add, think and dig, and their digs to read and post in.
              </p>
            )}
            {room.rows.length === 0 ? (
              <p className="room-empty">
                {shown === 'friends' ? 'Your friends have been quiet these four weeks.' : 'Nothing has happened in four weeks.'}
              </p>
            ) : (
              <ul className="room-rows">
                {room.rows.map((row) => {
                  const Row = ROWS[row.kind];
                  return Row ? <Row key={row.key} row={row} currentUser={currentUser} /> : null;
                })}
              </ul>
            )}
            {room.rows.length > 0 && <p className="room-end">That is everything from the last four weeks.</p>}
          </>
        )}
      </div>
    </FacesLead.Provider>
  );
}
