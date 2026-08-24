import React, { useState, useEffect, useCallback } from 'react';
import { getRoom } from '../api';
import RoomView from './RoomView';
import StatePill from './StatePill';

export default function RoomPage({ roomId, currentUser, onBack }) {
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
        <button onClick={onBack}>Back</button>
      </div>
    );
  }
  if (!room) return <div className="loading">Loading cohort…</div>;

  return (
    <div className="room-page">
      <button className="back-btn" onClick={onBack}>
        &larr; Back
      </button>

      <div className="panel">
        <div className="room-kicker-row">
          <p className="room-kicker">Seminar cohort</p>
          <StatePill status={room.status} />
        </div>
        <div className="seminar-head">
          <h2 className="room-title">
            {room.paper_id ? (
              <a href={`/paper/${room.paper_id}`} title="Open the paper">
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
