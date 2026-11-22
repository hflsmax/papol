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

// What a row holds, as lines: who did what, and when.
const linesOf = (row) => row.lines ?? [{ user: row.user, did: 'made', at: row.at }];
const DAY = 24 * 60 * 60 * 1000;
const DID = { thought: ['thought'], rated: ['rated'], dug: ['dug', 'posted'], added: ['added'], reading: ['reading'] };
const NONE = { kind: '', who: '', did: '', days: '' };

// The Lounge narrowed: by what a row is, whose it is, what they did and
// how lately. A row stays when one of its lines answers to all of them.
function narrowed(rows, pick) {
  const since = pick.days ? new Date(Date.now() - Number(pick.days) * DAY).toISOString() : '';
  return rows.filter((row) => (!pick.kind || row.kind === pick.kind) && linesOf(row).some((line) => (
    (!pick.who || line.user.uuid === pick.who)
    && (!pick.did || DID[pick.did].includes(line.did))
    && (!since || line.did === 'reading' || line.at >= since)
  )));
}

function Pick({ label, value, onChange, children }) {
  return (
    <label className="sort-control room-pick">
      <span className="visually-hidden">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  );
}

// The Lounge: what the member's friends are reading and what they
// make of it, a paper to a row, newest first, and nobody else's. The room
// holds four weeks, and the dropdowns above it narrow what shows.
export default function Room({ currentUser, onSeen }) {
  const [room, setRoom] = useState(() => kept('room'));
  const [error, setError] = useState(null);
  const friends = useFriends();
  const [pick, setPick] = useState(NONE);
  const set = (name) => (value) => setPick((was) => ({ ...was, [name]: value }));
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

  // Everyone with a line in the room, by name, to narrow by.
  const people = [...new Map((room?.rows ?? []).flatMap(linesOf).map((line) => [line.user.uuid, line.user])).values()]
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const narrowing = Object.values(pick).some(Boolean);
  const shown = room ? narrowed(room.rows, pick) : [];

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
                Add a friend from their nook.
              </p>
            ) : room.rows.length === 0 ? (
              <p className="room-empty">Your friends have been quiet these four weeks.</p>
            ) : (
              <>
                <div className="room-picks" role="group" aria-label="Narrow the Lounge">
                  <Pick label="Kind" value={pick.kind} onChange={set('kind')}>
                    <option value="">Everything</option>
                    <option value="paper">Papers</option>
                    <option value="board">Boards</option>
                    <option value="project">Projects</option>
                  </Pick>
                  <Pick label="Friend" value={pick.who} onChange={set('who')}>
                    <option value="">All friends</option>
                    {people.map((user) => <option key={user.uuid} value={user.uuid}>{user.display_name}</option>)}
                  </Pick>
                  <Pick label="Activity" value={pick.did} onChange={set('did')}>
                    <option value="">Any activity</option>
                    <option value="thought">Thoughts</option>
                    <option value="rated">Ratings</option>
                    <option value="dug">Digs</option>
                    <option value="added">Added</option>
                    <option value="reading">Reading this week</option>
                  </Pick>
                  <Pick label="When" value={pick.days} onChange={set('days')}>
                    <option value="">Last four weeks</option>
                    <option value="7">This week</option>
                    <option value="1">Today</option>
                  </Pick>
                  {narrowing && <button type="button" className="link-button room-picks-clear" onClick={() => setPick(NONE)}>Clear</button>}
                </div>
                {shown.length === 0 ? (
                  <p className="room-empty">Nothing in the Lounge matches.</p>
                ) : (
                  <ul className="room-rows">
                    {shown.map((row) => {
                      const Row = ROWS[row.kind];
                      return Row ? <Row key={row.key} row={row} currentUser={currentUser} /> : null;
                    })}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </FacesLead.Provider>
  );
}
