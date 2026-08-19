import React, { useState } from 'react';
import { callSeminar } from '../api';
import Avatar from './Avatar';
import StatePill from './StatePill';
import HintPop from './HintPop';
import { styleLabel, roomStyleDesc } from '../seminarStyles';

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

function RoomCard({ room, paper, currentUser }) {
  const [expanded, setExpanded] = useState(false);

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
              className="collapse-btn"
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
          called this seminar — waiting for a reader to step up and host
        </PersonLine>
      )}
      {room.status === 'planning' && (
        <PersonLine user={room.leader}>
          {' '}
          is hosting — the cohort is finding a time
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
          <PersonLine user={room.leader}> hosts</PersonLine>
        </>
      )}
      {(room.participants || []).length > 0 && (
        <div className="cohort-chips">
          <span className="cohort-label">
            Cohort of {room.participants.length}:
          </span>
          {room.participants.map((u) => (
            <a
              key={u.id}
              className="avatar-chip has-pop mini"
              href={`#/u/${u.id}`}
            >
              <Avatar user={u} className="mini-avatar" />
              <span className="chip-pop">
                <span className="chip-pop-name">
                  {u.display_name}
                  {currentUser && u.id === currentUser.id ? ' (you)' : ''}
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
          <a className="btn" href={`#/room/${room.id}`}>
            Open the room
          </a>
        </p>
      ) : (
        <p className="interest-count-note">Sign in to take part.</p>
      )}
    </div>
  );
}

export default function RoomSection({ paper, currentUser, onChanged }) {
  const rooms = paper.rooms || [];
  const [callWarning, setCallWarning] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [callHint, setCallHint] = useState(false);

  const call = async () => {
    setCallWarning(null);
    setIsBusy(true);
    try {
      await callSeminar(paper.id);
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
          key={room.id}
          room={room}
          paper={paper}
          currentUser={currentUser}
        />
      ))}

      {currentUser && !activeCall && paper.viewer_is_reader && (
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
      {currentUser && !activeCall && !paper.viewer_is_reader && (
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
                  paper.viewer_has_entry
                    ? 'Your copy of this paper is hidden. Put it on display before calling a seminar.'
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
