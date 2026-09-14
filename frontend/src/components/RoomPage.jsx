import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getRoom } from '../../../shared/api/rooms.js';
import RoomView from './RoomView';
import StatePill from './StatePill';
import { appPath } from '../base';
import BackLink from '../../../shared/ui/BackLink.jsx';
import { subscribeNativeSyncResults } from '../../../shared/nativeData.js';

export default function RoomPage({ roomUuid, currentUser, onBack, backHref }) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const roomRevision = useRef(0);

  const load = useCallback(() => {
    const requestedAt = roomRevision.current;
    getRoom(roomUuid)
      .then((updated) => {
        if (roomRevision.current === requestedAt) setRoom(updated);
      })
      .catch((e) => {
        if (roomRevision.current === requestedAt) setError(e.message);
      });
  }, [roomUuid]);

  const applyRoomUpdate = useCallback((updated) => {
    roomRevision.current += 1;
    setRoom(updated);
  }, []);

  useEffect(() => {
    roomRevision.current += 1;
    setRoom(null);
    setError(null);
    load();
  }, [load]);

  // A seminar may advance on another client. A completed desktop uplink or
  // downlink is the user's explicit reconciliation point, so refresh the
  // online-only room then as well as after actions performed in this view.
  useEffect(() => subscribeNativeSyncResults(load), [load]);

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
          onRoomChange={applyRoomUpdate}
          onReload={load}
          onUncalled={onBack}
        />
      </div>
    </div>
  );
}
