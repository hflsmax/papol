import React, { useContext, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import { findPeople, getRoom, markRoomSeen } from '../../../shared/api/friends.js';
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
import { InWay, WayShown } from './Way';
import FriendButton from './FriendButton';

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
            : `posted in ${whose} dig${place}`;
  const words = line.words && (
    <span className="room-words">“{line.words}”</span>
  );
  return (
    <li className={`room-line is-${line.did}`}>
      <span className="room-said">
        <span className="room-did">{did[0].toUpperCase() + did.slice(1)}</span>
        <time dateTime={line.at} title={when(line.at, { time: true })}>{when(line.at)}</time>
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
        <time className="room-when" dateTime={row.at} title={when(row.at, { time: true })}>{when(row.at)}</time>
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
        <time className="room-when" dateTime={row.at} title={when(row.at, { time: true })}>{when(row.at)}</time>
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
        <time className="room-when" dateTime={row.at} title={when(row.at, { time: true })}>{when(row.at)}</time>
      </div>
    </li>
  );
}

// Someone to ask, found by name: who they are, and the friend button.
function Finder({ currentUser, onDone }) {
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const asked = query.trim();

  useEffect(() => {
    setError(null);
    if (asked.length < 2) { setPeople(null); return undefined; }
    let active = true;
    // A pause in the typing asks; each letter does not.
    const wait = setTimeout(() => {
      findPeople(asked)
        .then((found) => { if (active) setPeople(found); })
        .catch((err) => { if (active) setError(err.message); });
    }, 200);
    return () => { active = false; clearTimeout(wait); };
  }, [asked]);

  return (
    <div className="desk-new room-finder">
      <input
        type="search" className="room-finder-box" value={query} autoFocus
        placeholder="Name or email" aria-label="Find someone by name or email"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onDone(); }}
      />
      {error && <div className="error" role="alert">{error}</div>}
      {people && people.length === 0 && <p className="room-finder-none">Nobody by that name.</p>}
      {people && people.length > 0 && (
        <ul className="room-found">
          {people.map((user) => (
            <li key={user.uuid}>
              <FacesLead.Provider value={false}><Face user={user} /></FacesLead.Provider>
              <span className="room-found-who">
                <a className="room-found-name" href={appPath(`/u/${user.uuid}`)}>{user.display_name}</a>
                {user.affiliation && <span className="room-found-where">{user.affiliation}</span>}
              </span>
              <FriendButton user={user} currentUser={currentUser} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ROWS = { paper: PaperRow, board: BoardRow, project: ProjectRow };

// What a row holds, as lines: who did what, and when.
const linesOf = (row) => row.lines ?? [{ user: row.user, did: 'made', at: row.at }];
const KINDS = [['', 'Everything'], ['paper', 'Papers'], ['board', 'Boards'], ['project', 'Projects']];
const NONE = { kind: '', who: '' };

// The Lounge narrowed, as the nook is by a shelf: by whose news it is and
// what a row is.
function narrowed(rows, pick) {
  return rows.filter((row) => (!pick.kind || row.kind === pick.kind)
    && (!pick.who || linesOf(row).some((line) => line.user.uuid === pick.who)));
}

// The Lounge: what the member's friends are reading and what they make of
// it, a paper to a row, newest first, and nobody else's. It is laid out as
// the nook is: a rail that says whose news and what kind, as the nook's
// says which shelf, and the rows in the nook's own card beside it.
export default function Room({ currentUser, onSeen }) {
  const [room, setRoom] = useState(() => kept('room'));
  const [error, setError] = useState(null);
  const friends = useFriends();
  const titled = useContext(WayShown);
  const [pick, setPick] = useState(NONE);
  const [finding, setFinding] = useState(false);
  const set = (name, value) => setPick((was) => ({ ...was, [name]: value }));
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

  const rows = room?.rows ?? [];
  const mine = friends?.friends ?? [];
  // A friend who has since left the list is no longer narrowed to.
  const who = mine.some((f) => f.user.uuid === pick.who) ? pick.who : '';
  const chosen = mine.find((f) => f.user.uuid === who)?.user;
  const shown = narrowed(rows, { ...pick, who });
  const count = (kind) => narrowed(rows, { ...NONE, who, kind }).length;

  return (
    <FacesLead.Provider value>
      <div className="nook-desk room">
        <aside className="desk-rail">
          <div className="desk-rail-body">
            <section className="desk-rail-part" aria-labelledby="room-friends">
              <div className="desk-rail-head">
                <h3 id="room-friends">Friends</h3>
                <button type="button" className="desk-quiet room-add" aria-expanded={finding} onClick={() => setFinding(!finding)}>{finding ? 'Done' : 'Find'}</button>
              </div>
              {finding && <Finder currentUser={currentUser} onDone={() => setFinding(false)} />}
              <ul className="desk-rail-list">
                <li>
                  <button type="button" className={who ? 'desk-row' : 'desk-row is-on'} aria-pressed={!who} onClick={() => set('who', '')}>
                    <span className="desk-row-name">All friends</span>
                    <span className="desk-count">{mine.length}</span>
                  </button>
                </li>
                {mine.map(({ user }) => (
                  <li key={user.uuid}>
                    <button type="button" className={who === user.uuid ? 'desk-row room-friend is-on' : 'desk-row room-friend'} aria-pressed={who === user.uuid} onClick={() => set('who', who === user.uuid ? '' : user.uuid)}>
                      <FacesLead.Provider value={false}><Face user={user} /></FacesLead.Provider>
                      <span className="desk-row-name">{user.display_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="desk-rail-part" aria-labelledby="room-kinds">
              <div className="desk-rail-head"><h3 id="room-kinds">Show</h3></div>
              <ul className="desk-rail-list">
                {KINDS.map(([kind, name]) => (
                  <li key={kind || 'all'}>
                    <button type="button" className={pick.kind === kind ? 'desk-row is-on' : 'desk-row'} aria-pressed={pick.kind === kind} onClick={() => set('kind', kind)}>
                      <span className="desk-row-name">{name}</span>
                      <span className="desk-count">{count(kind)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </aside>

        <section className="desk-main" aria-label="The Lounge">
          {titled && (
            <InWay><h2 className="desk-main-title">{chosen ? chosen.display_name : 'Lounge'}{chosen && <a className="room-nook-link" href={appPath(`/u/${chosen.uuid}`)}>{first(chosen)}’s nook</a>}</h2></InWay>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          {!room && !error && <div className="loading"><Working label="Loading the Lounge…" /></div>}
          {room && room.friend_count === 0 && (
            <p className="room-note">
              The Lounge is your friends’ news: what they add, think and dig, and their digs to read and post in.
              Press Find beside Friends to ask someone.
            </p>
          )}
          {room && room.friend_count > 0 && rows.length === 0 && (
            <p className="room-empty">Your friends have been quiet these four weeks.</p>
          )}
          {rows.length > 0 && (
            <>
              {shown.length === 0 ? (
                <p className="room-empty">Nothing here yet.</p>
              ) : (
                <div className="room-card">
                  <div className="room-head" aria-hidden="true"><span>Title</span><span>Friends</span><span>Latest</span></div>
                  <ul className="room-rows">
                    {shown.map((row) => {
                      const Row = ROWS[row.kind];
                      return Row ? <Row key={row.key} row={row} currentUser={currentUser} /> : null;
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </FacesLead.Provider>
  );
}
