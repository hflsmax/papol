import React, { useState, useEffect, useCallback } from 'react';
import { getRoom } from '../api';
import RoomView from './RoomView';
import StatePill from './StatePill';
import { appPath } from '../base';
import BackLink from './BackLink';

export default function RoomPage({ roomId, currentUser, onBack, backHref }) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    getRoom(roomId)
      .then(setRoom)
      .catch((e) => setError(e.message));
  }, [roomId]);

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
            {room.paper_id ? (
              <a href={appPath(`/paper/${room.paper_id}`)} title="Open the paper">
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
