import React, { useContext, useEffect, useRef, useState } from 'react';
import { Working } from '../../../shared/ui/Waiting.js';
import {
  findPeople, getRoom, getSuggestions, hideSuggestion, markRoomSeen,
} from '../../../shared/api/friends.js';
import { plainWords } from '../../../shared/markdownFormat.js';
import { paperName } from '../../../shared/paperName.js';
import NewsDot from '../../../shared/ui/NewsDot.jsx';
import PaperTitle from '../../../shared/ui/PaperTitle.jsx';
import Face, { FacesLead } from '../../../shared/ui/Face.jsx';
import { TalkCard, when } from '../../../shared/ui/Talk.jsx';
import { appPath } from '../base';
import { formatAuthors } from '../paperFormat';
import { keep, kept } from '../lastMember';
import { loadFriends, useFriends } from '../friendsStore';
import { RatingSummary } from './Rating';
import { InWay, WayShown } from './Way';
import FriendButton from './FriendButton';
import ThreadComposer from './ThreadComposer';
import { DESKTOP } from '../../../shared/desktopShell';
import { KINDS, narrowed, setLounge, useLounge } from '../loungeStore';

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

// A face in a row leads to its person's nook, and resting on it brings up
// what they did. Where nothing can rest, the first press brings that up
// and the next one leads.
function Who({ user, held = false, children }) {
  const shown = useRef(false);
  const press = (event) => {
    if (shown.current || !window.matchMedia?.('(hover: none)').matches) return;
    event.preventDefault();
    shown.current = true;
    event.currentTarget.focus();
  };
  return (
    <span className={`room-who${held ? ' is-held' : ''}`}>
      <a
        className="room-who-face" href={appPath(`/u/${user.uuid}`)} aria-label={`${user.display_name}’s nook`}
        onClick={press} onBlur={() => { shown.current = false; }}
      >
        <FacesLead.Provider value={false}><Face user={user} /></FacesLead.Provider>
      </a>
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

// A thread: something a friend, or I, sent to the Lounge from a paper,
// and what was replied to it. The row says what it is about, in the
// sender's words if they wrote any, and leads to the thread's jacket,
// where it is read and replied in.
function ThreadRow({ row }) {
  const { thread, paper } = row;
  const replies = thread.replies.length;
  // The starter's words are Markdown; the row is one plain line of them.
  const about = (thread.words && plainWords(thread.words)) || thread.excerpt;
  // With no words, what was attached says what the thread is.
  const attached = thread.files ?? [];
  const carried = attached.length === 0 ? '' : attached.length === 1 ? attached[0].name
    : attached.every((f) => f.is_picture) ? `${attached.length} pictures` : `${attached.length} files`;
  return (
    <li className={`room-row is-thread${row.is_new ? ' is-new' : ''}`}>
      <div className="room-row-head">
        <div className="room-row-text">
          <a className="room-thread-open" href={appPath(`/thread/${thread.uuid}`)}>
            <span className="room-kind">Thread</span>
            <span className={`desk-title room-title room-thread-about${thread.words ? '' : ' is-quote'}`}>
              {about ? (thread.words ? about : `“${about}”`) : (carried || 'A clip')}
            </span>
            {row.is_new && <NewsDot />}
          </a>
          <span className="desk-meta room-meta">
            {replies > 0 && `${replies} ${replies === 1 ? 'reply' : 'replies'}${paper || (about && carried) ? ' · ' : ''}`}
            {paper ? <><PaperTitle title={paper.title} />, page {thread.page}</> : [replies > 0 ? null : 'No replies yet', about && carried].filter(Boolean).join(' · ')}
          </span>
        </div>
        <span className="room-faces">
          {row.lines.map((line) => (
            <Who key={line.user.uuid} user={line.user}>
              <Said at={line.at}>{line.did === 'started' ? 'Started the thread' : 'Replied'}</Said>
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
              <Face user={user} />
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

// Why someone is suggested, in a line: the project we are both in, then
// how many friends we both have.
export function suggestionReason(suggestion) {
  const parts = [];
  const more = suggestion.project_count - 1;
  if (suggestion.project_count > 0) parts.push(`in ${suggestion.projects[0].name}${more > 0 ? ` and ${more} more ${more === 1 ? 'project' : 'projects'}` : ''} with you`);
  if (suggestion.mutual_count > 0) parts.push(`${suggestion.mutual_count} ${suggestion.mutual_count === 1 ? 'friend' : 'friends'} in common`);
  const said = parts.join(', and ');
  return said ? said[0].toUpperCase() + said.slice(1) : '';
}

// How many people are suggested at once; the next come up as these go.
const SUGGESTED = 3;

// People to ask, above the news: who they are, why Papol names them, the
// friend button, and Not interested, which takes them out for good.
// Someone asked keeps their card for a week (the server's rule), so the
// asking can be taken back where it was done.
function Suggestions({ currentUser }) {
  const [people, setPeople] = useState(() => kept('room-suggestions') ?? null);
  const [error, setError] = useState(null);
  const take = (next) => { keep('room-suggestions', next); setPeople(next); };

  useEffect(() => {
    let active = true;
    getSuggestions().then((next) => { if (active) take(next); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const hide = async (user) => {
    setError(null);
    // Gone at once; the answer brings whoever is next.
    setPeople((now) => now.filter((s) => s.user.uuid !== user.uuid));
    try { take(await hideSuggestion(user.uuid)); } catch (err) { setError(err.message); }
  };

  if (!people?.length) return null;
  return (
    <section className="room-suggested" aria-labelledby="room-suggested">
      <h3 id="room-suggested" className="room-suggested-head">People you may know</h3>
      {error && <div className="error" role="alert">{error}</div>}
      <ul className="room-suggestions">
        {people.slice(0, SUGGESTED).map((suggestion) => {
          const { user } = suggestion;
          return (
            <li key={user.uuid} className="room-suggestion">
              <Face user={user} />
              <span className="room-suggestion-who">
                <a className="room-found-name" href={appPath(`/u/${user.uuid}`)}>{user.display_name}</a>
                {user.affiliation && <span className="room-found-where">{user.affiliation}</span>}
              </span>
              <FriendButton user={user} currentUser={currentUser} />
              <button type="button" className="room-suggestion-hide" title={`Not interested: stop suggesting ${first(user)}`} aria-label={`Not interested: stop suggesting ${user.display_name}`} onClick={() => hide(user)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg>
              </button>
              <span className="room-suggestion-why">{suggestionReason(suggestion)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const ROWS = { paper: PaperRow, board: BoardRow, project: ProjectRow, thread: ThreadRow };

const NONE = { kind: '', who: '' };
// How many rows the room shows before Show more.
const PAGE = 50;

// The Lounge: what the member's friends are reading and what they make of
// it, a paper to a row, newest first, and nobody else's. It is laid out as
// the nook is: a rail that says whose news and what kind, as the nook's
// says which shelf, and the rows in the nook's own card beside it. In the
// Mac app that rail is the window's sidebar, in Lounge mode
// (DesktopChrome.jsx), and the page is the card alone.
export default function Room({ currentUser, onSeen }) {
  const [room, setRoom] = useState(() => kept('room'));
  const [error, setError] = useState(null);
  const friends = useFriends();
  const titled = useContext(WayShown);
  // What the room is narrowed to lives beside the page, so the Mac's
  // sidebar can narrow it too.
  const { kind, who: pickedWho, finding } = useLounge();
  const pick = { kind, who: pickedWho };
  const setFinding = (next) => setLounge({ finding: next });
  // The room is shown a part at a time; narrowing starts it from the top.
  const [upTo, setUpTo] = useState(PAGE);
  useEffect(() => { setUpTo(PAGE); }, [kind, pickedWho]);
  const set = (name, value) => setLounge({ [name]: value });
  // The room is marked seen once per visit: what was new when it opened
  // keeps its dot until the member comes back.
  const marked = useRef(false);
  // Read again each visit: a friend may have accepted since.
  useEffect(() => { loadFriends().catch(() => {}); }, []);

  useEffect(() => {
    let active = true;
    setError(null);
    setRoom(kept('room'));
    if (kept('room')) setLounge({ rows: kept('room').rows ?? [] });
    getRoom()
      .then((next) => {
        if (!active) return;
        keep('room', next);
        setRoom(next);
        setLounge({ rows: next.rows ?? [] });
        if (!marked.current) {
          marked.current = true;
          markRoomSeen().then(() => onSeen?.()).catch(() => {});
        }
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
    // Friends made or ended here change who the room is made from.
  }, [friends?.friends.length]);

  // A thread I started here: the room's newest row, at once.
  const onStarted = (thread) => {
    const row = {
      kind: 'thread', key: `thread:${thread.uuid}`, at: thread.created_at, is_new: false, thread, paper: thread.paper ?? null,
      lines: [{ user: thread.user, did: 'started', at: thread.created_at }],
    };
    const changed = { ...(room ?? {}), rows: [row, ...(room?.rows ?? [])] };
    keep('room', changed);
    setRoom(changed);
    setLounge({ rows: changed.rows });
  };

  const rows = room?.rows ?? [];
  const mine = friends?.friends ?? [];
  // A friend who has since left the list is no longer narrowed to.
  const who = mine.some((f) => f.user.uuid === pick.who) ? pick.who : '';
  const chosen = mine.find((f) => f.user.uuid === who)?.user;
  const shown = narrowed(rows, { ...pick, who });
  const count = (kind) => narrowed(rows, { ...NONE, who, kind }).length;

  return (
    <FacesLead.Provider value>
      <div className={`nook-desk room${DESKTOP ? ' is-railless' : ''}`}>
        {!DESKTOP && (
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
                  <li key={user.uuid} className="room-friend-item">
                    {/* The face leads to their nook; the name narrows the news to them. */}
                    <Face user={user} />
                    <button type="button" className={who === user.uuid ? 'desk-row room-friend is-on' : 'desk-row room-friend'} aria-pressed={who === user.uuid} onClick={() => set('who', who === user.uuid ? '' : user.uuid)}>
                      <span className="room-friend-gap" aria-hidden="true" />
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
        )}

        <section className="desk-main" aria-label="The Lounge">
          {DESKTOP && finding && <Finder currentUser={currentUser} onDone={() => setFinding(false)} />}
          {titled && (
            <InWay><h2 className="desk-main-title">{chosen ? chosen.display_name : 'Lounge'}{chosen && <a className="room-nook-link" href={appPath(`/u/${chosen.uuid}`)}>{first(chosen)}’s nook</a>}</h2></InWay>
          )}
          {error && <div className="error" role="alert">{error}</div>}
          {room && room.friend_count > 0 && !chosen && <ThreadComposer currentUser={currentUser} onStarted={onStarted} />}
          {room && !chosen && <Suggestions currentUser={currentUser} />}
          {!room && !error && <div className="loading"><Working label="Loading the Lounge…" /></div>}
          {room && room.friend_count > 0 && rows.length === 0 && (
            <p className="room-empty">Your friends have been quiet this month. Start a thread above, or select something in a paper and send it here.</p>
          )}
          {rows.length > 0 && (
            <>
              {shown.length === 0 ? (
                <p className="room-empty">Nothing here yet.</p>
              ) : (
                <div className="room-card">
                  <div className="room-head" aria-hidden="true"><span>Title</span><span>Friends</span><span>Latest</span></div>
                  <ul className="room-rows">
                    {shown.slice(0, upTo).map((row) => {
                      const Row = ROWS[row.kind];
                      return Row ? <Row key={row.key} row={row} currentUser={currentUser} /> : null;
                    })}
                  </ul>
                  {shown.length > upTo && (
                    <button type="button" className="room-more" onClick={() => setUpTo(upTo + PAGE)}>
                      Show more <span className="room-more-left">{shown.length - upTo} older</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </FacesLead.Provider>
  );
}
