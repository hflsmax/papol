import React, { useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { getRoom, markRoomSeen } from '../../../shared/api/friends.js';
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

const first = (user) => user?.display_name?.split(' ')[0] ?? 'Someone';
const metaOf = (paper) => [formatAuthors(paper.authors), paper.year, paper.journal].filter(Boolean).join(' · ');

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
function Line({ line, title, currentUser, onOpen }) {
  const [open, setOpen] = useState(false);
  const whose = line.dig?.owner?.uuid === currentUser.uuid ? 'your' : line.dig?.owner?.uuid === line.user.uuid ? 'their' : `${first(line.dig?.owner)}’s`;
  const place = line.dig?.page ? ` on page ${line.dig.page}` : '';
  const did = line.did === 'added' ? 'added it'
      : line.did === 'thought' ? 'thought'
        : line.did === 'rated' ? 'rated it'
          : line.did === 'dug' ? `dug${place}`
            : line.did === 'posted' ? `posted in ${whose} dig${place}`
              : 'reading it this week';
  const words = line.words && (
    <span className="room-words">“{line.words}”</span>
  );
  return (
    <li className={`room-line is-${line.did}`}>
      <span className="room-said">
        <span className="room-did">{did[0].toUpperCase() + did.slice(1)}</span>
        {/* A reading line says only that it happened this week. */}
        {line.did !== 'reading' && <time dateTime={line.at} title={when(line.at, { time: true })}>{when(line.at)}</time>}
        {line.dig ? (
          <button type="button" className="room-dig-open" aria-expanded={open} onClick={() => { onOpen?.(!open); setOpen(!open); }}>
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

function Who({ user, held = false, children }) {
  return (
    <span className={`room-who${held ? ' is-held' : ''}`}>
      <span className="room-who-face" tabIndex={0} role="button" aria-label={`What ${user.display_name} did`}>
        <FacesLead.Provider value={false}><Face user={user} /></FacesLead.Provider>
      </span>
      <div className="room-pop">
        <div className="room-pop-who">
          <Face user={user} />
          <a className="room-person" href={appPath(`/u/${user.uuid}`)}>{user.display_name}</a>
        </div>
        {children}
      </div>
    </span>
  );
}

// One plain line of what someone did, for a row that is not a paper.
function Said({ at, children }) {
  return (
    <div className="room-line">
      <span className="room-said">
        <span className="room-did">{children}</span>
        <time dateTime={at} title={when(at, { time: true })}>{when(at)}</time>
      </span>
    </div>
  );
}

function PaperWho({ user, lines, title, currentUser }) {
  const [held, setHeld] = useState(false);
  return (
    <Who user={user} held={held}>
      <ul className="room-lines">
        {lines.map((line) => (
          <Line key={`${line.did}:${line.dig?.uuid ?? ''}`} line={line} title={title} currentUser={currentUser} onOpen={setHeld} />
        ))}
      </ul>
    </Who>
  );
}

// Each person once, in the order their newest line came, with their lines.
function byPerson(lines) {
  const people = new Map();
  for (const line of lines) {
    if (!people.has(line.user.uuid)) people.set(line.user.uuid, { user: line.user, lines: [] });
    people.get(line.user.uuid).lines.push(line);
  }
  return [...people.values()];
}

function PaperRow({ row, currentUser }) {
  return (
    <li className={`room-row is-paper${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <a className="desk-title room-title" href={appPath(`/paper/${paperName(row.paper.sha256)}`)}><PaperTitle title={row.paper.title} /></a>
          {row.is_new && <NewsDot />}
          <span className="desk-meta room-meta">{metaOf(row.paper)}</span>
        </div>
        <span className="room-faces">
          {byPerson(row.lines).map(({ user, lines }) => (
            <PaperWho key={user.uuid} user={user} lines={lines} title={row.paper.title} currentUser={currentUser} />
          ))}
        </span>
      </div>
    </li>
  );
}

function BoardRow({ row }) {
  return (
    <li className={`room-row is-board${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <span className="room-kind">Board</span>
          <a className="desk-title room-title" href={appPath(`/board/${row.board.uuid}`)}>{row.board.name}</a>
          {row.is_new && <NewsDot />}
          <span className="desk-meta room-meta">{row.board.item_count} {row.board.item_count === 1 ? 'card' : 'cards'}{row.board.description ? ` · ${row.board.description}` : ''}</span>
        </div>
        <span className="room-faces">
          <Who user={row.user}>
            <Said at={row.at}>Put a board on a public shelf</Said>
          </Who>
        </span>
      </div>
    </li>
  );
}

// A project I am in opens; one I am not in leads to the Projects page,
// where asking to join is.
function ProjectRow({ row }) {
  return (
    <li className={`room-row is-project${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <span className="room-kind">Project</span>
          <a className="desk-title room-title" href={appPath(row.project.is_member ? `/project/${row.project.uuid}` : '/projects')}>{row.project.name}</a>
          {row.is_new && <NewsDot />}
          <span className="desk-meta room-meta">
            {row.project.member_count} {row.project.member_count === 1 ? 'member' : 'members'}
            {row.project.description ? ` · ${row.project.description}` : ''}
          </span>
        </div>
        <span className="room-faces">
          {row.lines.map((l) => (
            <Who key={`${l.user.uuid}:${l.did}`} user={l.user}>
              <Said at={l.at}>{l.did === 'started' ? 'Started the project' : l.did === 'keeps' ? 'Keeps the project' : 'Joined the project'}</Said>
            </Who>
          ))}
        </span>
      </div>
    </li>
  );
}

const ROWS = { paper: PaperRow, board: BoardRow, project: ProjectRow };

// The Lounge: what the member's friends are reading and what they
// make of it, a paper to a row, newest first, and nobody else's. The room
// holds four weeks, and ends.
export default function Room({ currentUser, onSeen }) {
  const [room, setRoom] = useState(() => kept('room'));
  const [error, setError] = useState(null);
  const friends = useFriends();
  // The room is marked seen once per visit: what was new when it opened
  // keeps its dot until the member comes back.
  const marked = useRef(false);

  useEffect(() => {
    let active = true;
    setError(null);
    setRoom(kept('room'));
    getRoom()
      .then((next) => {
        if (!active) return;
        keep('room', next);
        setRoom(next);
        if (!marked.current) {
          marked.current = true;
          markRoomSeen().then(() => onSeen?.()).catch(() => {});
        }
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
    // Friends made or ended here change who the room is made from.
  }, [friends?.friends.length]);


  return (
    <FacesLead.Provider value>
      <div className="room">
        {error && <div className="error" role="alert">{error}</div>}
        {!room && !error && <div className="loading"><Working label="Loading the Lounge…" /></div>}
        {room && (
          <>
            {room.friend_count === 0 ? (
              <p className="room-note">
                The Lounge is your friends’ news: what they add, think and dig, and their digs to read and post in.
                Add a friend from their nook, or send someone your friend link from the{' '}
                <a href={appPath('/profile')}>Friends tab</a>.
              </p>
            ) : room.rows.length === 0 ? (
              <p className="room-empty">Your friends have been quiet these four weeks.</p>
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
