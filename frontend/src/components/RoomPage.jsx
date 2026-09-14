import React, { useState, useEffect, useCallback } from 'react';
import { getRoom } from '../../../shared/api/rooms.js';
import RoomView from './RoomView';
import StatePill from './StatePill';
import { appPath } from '../base';
import BackLink from '../../../shared/ui/BackLink.jsx';

export default function RoomPage({ roomUuid, currentUser, onBack, backHref }) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getRoom(roomUuid)
      .then(setRoom)
      .catch((e) => setError(e.message));
  }, [roomUuid]);

  useEffect(() => {
    setRoom(null);
    setError(null);
    load();
  }, [load]);

  if (error) {
    return (
      <div className="panel">
        <div className="error">{error}</div>
        <BackLink href={backHref} onBack={onBack}>Back</BackLink>
      </div>
    );
  }
  if (!room) return <div className="loading">Loading cohort…</div>;

  return (
    <div className="room-page">
      <BackLink className="back-btn" href={backHref} onBack={onBack} />

      <div className="panel">
        <div className="room-kicker-row">
          <p className="room-kicker">Seminar cohort</p>
          <StatePill status={room.status} />
        </div>
        <div className="seminar-head">
          <h2 className="room-title">
            {room.paper_uuid ? (
              <a href={appPath(`/paper/${room.paper_uuid}`)} title="Open the paper">
                {room.paper_title}
              </a>
            ) : (
              room.paper_title
            )}
          </h2>
        </div>

        <RoomView
          room={room}
          currentUser={currentUser}
          onRoomChange={setRoom}
          onReload={load}
        />
      </div>
    </div>
  );
}
