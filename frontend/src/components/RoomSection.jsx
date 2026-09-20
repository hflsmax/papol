import React, { useEffect, useRef, useState } from 'react';
import {
  callSeminar, listPaperRooms, uncallSeminar,
} from '../../../shared/api/rooms.js';
import {
  nativeDataActive, subscribeNativeSyncResults,
} from '../../../shared/nativeData.js';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';
import { canUncall, roomStyleDesc, styleLabel } from '../seminarStyles';
import { appPath } from '../base';
import { confirmAction } from '../../../shared/confirmAction';

function formatDay(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function PersonLine({ user, children }) {
  return (
    <p className="seminar-person">
      <Avatar user={user} className="mini-avatar" />
      <span>
        <strong>{user.display_name}</strong>
        {children}
      </span>
    </p>
  );
}

function RoomCard({ room, paper, currentUser, isBusy, onUncall }) {
  const [expanded, setExpanded] = useState(false);
  const uncallable = canUncall(room, currentUser);

  if (room.status === 'finished' && !expanded) {
    return (
      <button
        className="seminar-card finished collapsed"
        onClick={() => setExpanded(true)}
        title="Show this seminar"
      >
        <StatePill status="finished" link={false} />
        <span className="collapsed-meta">
          {room.scheduled_time} · {room.platform}
        </span>
        <span className="collapsed-caret" aria-hidden="true">
          ▸
        </span>
      </button>
    );
  }

  return (
    <div className={`seminar-card ${room.status}`}>
      <div className="seminar-card-top">
        <StatePill status={room.status} />
        <span className="seminar-card-date">
          {room.status === 'finished' ? 'held' : 'called'}{' '}
          {formatDay(room.created_at)}
          {room.status === 'finished' && (
            <button
              className="collapse-button"
              onClick={() => setExpanded(false)}
              title="Collapse this seminar"
              aria-label="Collapse this seminar"
            >
              ▴
            </button>
          )}
        </span>
      </div>
      {room.status === 'open' && (
        <PersonLine user={room.creator}>
          {' '}
          called this seminar — waiting for a user to step up and lead
        </PersonLine>
      )}
      {room.status === 'planning' && (
        <PersonLine user={room.leader}>
          {' '}
          is leading — the cohort is finding a time
        </PersonLine>
      )}
      {(room.status === 'scheduled' || room.status === 'finished') && (
        <>
          <p className="seminar-when">
            <strong>{room.scheduled_time}</strong>
            <span className="seminar-where"> · {room.platform}</span>
            {room.style && (
              <span className="style-tag" title={roomStyleDesc(room) || undefined}>
                {styleLabel(room.style)}
              </span>
            )}
          </p>
          <PersonLine user={room.leader}> leads</PersonLine>
        </>
      )}
      {room.participants.length > 0 && (
        <div className="cohort-chips">
          <span className="cohort-label">
            Cohort of {room.participants.length}:
          </span>
          {room.participants.map((u) => (
            <a
              key={u.uuid}
              className="avatar-chip has-pop mini"
              href={appPath(`/u/${u.uuid}`)}
            >
              <Avatar user={u} className="mini-avatar" />
              <span className="chip-pop">
                <span className="chip-pop-name">
                  {u.display_name}
                  {currentUser && u.uuid === currentUser.uuid ? ' (you)' : ''}
                </span>
                {u.affiliation && (
                  <span className="chip-pop-aff">{u.affiliation}</span>
                )}
              </span>
            </a>
          ))}
        </div>
      )}
      {currentUser ? (
        <p className="room-enter">
          <a className="button" href={appPath(`/room/${room.uuid}`)}>
            Open the room
          </a>
          {uncallable && (
            <button
              type="button"
              className="danger"
              disabled={isBusy}
              onClick={() => onUncall(room)}
            >
              Uncall seminar
            </button>
          )}
        </p>
      ) : (
        <p className="interest-count-note">Sign in to take part.</p>
      )}
    </div>
  );
}

export default function RoomSection({ paper, currentUser, onChanged }) {
  const [desktopRooms, setDesktopRooms] = useState(null);
  const roomsRevision = useRef(0);
  const [callWarning, setCallWarning] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [callHint, setCallHint] = useState(false);

  // The desktop paper view comes from SQLite, which intentionally contains
  // the user's offline data but not shared seminar cohorts. Enrich just this
  // online-only section without holding up the rest of the paper page.
  useEffect(() => {
    roomsRevision.current += 1;
    setDesktopRooms(null);
    if (!nativeDataActive()) return undefined;
    let active = true;
    const refresh = () => {
      const requestedAt = roomsRevision.current;
      listPaperRooms(paper.sha256)
        .then((rooms) => {
          if (active && roomsRevision.current === requestedAt) setDesktopRooms(rooms);
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = subscribeNativeSyncResults(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [paper.sha256]);

  const rooms = desktopRooms ?? paper.rooms ?? [];

  const call = async () => {
    setCallWarning(null);
    setIsBusy(true);
    try {
      const room = await callSeminar(paper.sha256);
      // The server response is authoritative. Use it immediately because a
      // subsequent desktop paper reload still reads its offline replica.
      roomsRevision.current += 1;
      setDesktopRooms((current) => [
        room,
        ...(current ?? paper.rooms ?? []).filter((item) => item.uuid !== room.uuid),
      ]);
      if (onChanged) onChanged();
    } catch (err) {
      setCallWarning(err.message);
    } finally {
      setIsBusy(false);
    }
  };

  const uncall = async (room) => {
    if (!(await confirmAction('Uncall this seminar? The empty cohort will be removed.', {
      confirmLabel: 'Uncall seminar',
      destructive: true,
    }))) return;
    setCallWarning(null);
    setIsBusy(true);
    try {
      await uncallSeminar(room.uuid);
      roomsRevision.current += 1;
      setDesktopRooms((current) =>
        (current ?? paper.rooms ?? []).filter((item) => item.uuid !== room.uuid)
      );
      if (onChanged) onChanged();
    } catch (err) {
      setCallWarning(err.message);
    } finally {
      setIsBusy(false);
    }
  };

  // At most one seminar is being organized at a time; scheduled ones may pile up
  const activeCall = rooms.some(
    (r) => r.status === 'open' || r.status === 'planning'
  );

  return (
    <div className="seminar-section">
      <div className="seminar-head">
        <h4>Seminars</h4>
      </div>

      {!currentUser && rooms.length === 0 && (
        <p className="interest-count-note">Sign in to call for a seminar.</p>
      )}

      {rooms.map((room) => (
        <RoomCard
          key={room.uuid}
          room={room}
          paper={paper}
          currentUser={currentUser}
          isBusy={isBusy}
          onUncall={uncall}
        />
      ))}

      {currentUser && !activeCall && paper.is_public && (
        <div className="call-block">
          <span className="hint-anchor">
            <button className="primary" disabled={isBusy} onClick={call}>
              {rooms.length > 0 ? 'Call for another seminar' : 'Call for a seminar'}
            </button>
            {callWarning && (
              <HintPop
                text={callWarning}
                onClose={() => setCallWarning(null)}
              />
            )}
          </span>
        </div>
      )}
      {currentUser && !activeCall && !paper.is_public && (
        <div className="call-block">
          <span className="hint-anchor">
            <button
              className="primary"
              onClick={(e) => {
                e.stopPropagation();
                setCallHint(true);
              }}
            >
              Call for a seminar
            </button>
            {callHint && (
              <HintPop
                text={
                  paper.copy_uuid
                    ? 'Move this paper to a public shelf before calling a seminar.'
                    : 'Add this paper to your nook before calling a seminar.'
                }
                onClose={() => setCallHint(false)}
              />
            )}
          </span>
        </div>
      )}
    </div>
  );
}
