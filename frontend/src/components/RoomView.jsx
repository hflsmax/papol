import React, { useState } from 'react';
import {
  leadRoom,
  joinRoom,
  leaveRoom,
  unhostRoom,
  postRoomMessage,
  setRoomAvailability,
  announceRoom,
  finishRoom,
  updatePaper,
} from '../api';
import Avatar from './Avatar';
import HintPop from './HintPop';
import { SEMINAR_STYLES, styleLabel, roomStyleDesc } from '../seminarStyles';

function formatWhen(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The interactive body of a seminar room.
export default function RoomView({ room, currentUser, onRoomChange, onReload }) {
  const [actionError, setActionError] = useState(null);
  const [message, setMessage] = useState('');
  const [availability, setAvailability] = useState(() => {
    const mine = room.availabilities.find((a) => a.user.id === currentUser.id);
    return mine ? mine.availability : '';
  });
  const [announceTime, setAnnounceTime] = useState('');
  const [announcePlatform, setAnnouncePlatform] = useState('');
  const [announceStyle, setAnnounceStyle] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [customStyleDesc, setCustomStyleDesc] = useState('');
  const [editingAnnounce, setEditingAnnounce] = useState(false);

  const isCustomStyle = announceStyle === 'custom';
  const chosenStyle = isCustomStyle ? customStyle.trim() : announceStyle;
  const chosenStyleDesc = isCustomStyle ? customStyleDesc.trim() || null : null;

  const startAnnounceEdit = () => {
    setAnnounceTime(room.scheduled_time || '');
    setAnnouncePlatform(room.platform || '');
    if (SEMINAR_STYLES.some((s) => s.key === room.style)) {
      setAnnounceStyle(room.style);
      setCustomStyle('');
      setCustomStyleDesc('');
    } else {
      setAnnounceStyle(room.style ? 'custom' : '');
      setCustomStyle(room.style || '');
      setCustomStyleDesc(room.style_desc || '');
    }
    setEditingAnnounce(true);
  };
  const [isBusy, setIsBusy] = useState(false);
  const [msgHint, setMsgHint] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leadWarning, setLeadWarning] = useState(null);
  const [joinWarning, setJoinWarning] = useState(null);
  const [successorId, setSuccessorId] = useState('');

  const run = (fn) => async () => {
    setActionError(null);
    setIsBusy(true);
    try {
      const updated = await fn();
      onRoomChange(updated);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const isLeader = room.leader && room.leader.id === currentUser.id;
  const myAvail = room.availabilities.find((a) => a.user.id === currentUser.id);

  const leadsRoom = (u) => room.leader && u.id === room.leader.id;
  const participants = [...room.participants].sort(
    (a, b) => leadsRoom(b) - leadsRoom(a)
  );

  return (
    <div className="room-view">
      {actionError && <div className="error">{actionError}</div>}

      {/* ---- Stage ---- */}
      {room.status === 'open' && (
        <div className="stage-card open">
          <h5>Seminar called — waiting for a host</h5>
          <p>Called by {room.creator.display_name}.</p>
          <p className="stage-hint">
            The host is the seminar's benevolent dictator: they volunteer to
            plan its time, place, and style, and to lead the discussion.
          </p>
          {room.viewer_is_reader ? (
            <span className="hint-anchor">
              <button
                className="primary stage-action"
                disabled={isBusy}
                onClick={async () => {
                  setActionError(null);
                  setLeadWarning(null);
                  setIsBusy(true);
                  try {
                    onRoomChange(await leadRoom(room.id));
                  } catch (e) {
                    setLeadWarning(e.message);
                  } finally {
                    setIsBusy(false);
                  }
                }}
              >
                Answer to host
              </button>
              {leadWarning && (
                <HintPop
                  text={leadWarning}
                  onClose={() => setLeadWarning(null)}
                />
              )}
            </span>
          ) : (
            <p className="stage-hint">
              Only readers with a displayed entry can host.
            </p>
          )}
        </div>
      )}
      {isLeader &&
        (room.status === 'planning' ||
          (room.status === 'scheduled' && editingAnnounce)) && (
        <div className="announce-card">
          <h6 className="mini-title">
            {editingAnnounce ? 'Edit the seminar' : 'Announce the seminar'}
          </h6>
          <div className="announce-fields">
            <div className="form-group">
              <label>Time</label>
              <input
                type="text"
                value={announceTime}
                onChange={(e) => setAnnounceTime(e.target.value)}
                placeholder="e.g. Friday Aug 22, 4:00 pm CET"
              />
            </div>
            <div className="form-group">
              <label>Platform / place</label>
              <input
                type="text"
                value={announcePlatform}
                onChange={(e) => setAnnouncePlatform(e.target.value)}
                placeholder="e.g. Zoom link, seminar room 2.13"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Style</label>
            <div className="style-options">
              {SEMINAR_STYLES.map((s) => (
                <label
                  key={s.key}
                  className={
                    announceStyle === s.key
                      ? 'style-option selected'
                      : 'style-option'
                  }
                >
                  <input
                    type="radio"
                    name="seminar-style"
                    value={s.key}
                    checked={announceStyle === s.key}
                    onChange={() => setAnnounceStyle(s.key)}
                  />
                  <span>
                    <strong>{s.label}</strong>
                    <span className="style-desc">{s.desc}</span>
                  </span>
                </label>
              ))}
              <label
                className={
                  announceStyle === 'custom'
                    ? 'style-option selected'
                    : 'style-option'
                }
              >
                <input
                  type="radio"
                  name="seminar-style"
                  value="custom"
                  checked={announceStyle === 'custom'}
                  onChange={() => setAnnounceStyle('custom')}
                />
                <span className="style-custom">
                  <strong>Your own</strong>
                  <input
                    type="text"
                    className="style-custom-input"
                    value={customStyle}
                    maxLength={40}
                    placeholder="title, e.g. Socratic dialogue"
                    onFocus={() => setAnnounceStyle('custom')}
                    onChange={(e) => setCustomStyle(e.target.value)}
                  />
                  <input
                    type="text"
                    className="style-custom-input"
                    value={customStyleDesc}
                    maxLength={300}
                    placeholder="what participants should expect and prepare"
                    onFocus={() => setAnnounceStyle('custom')}
                    onChange={(e) => setCustomStyleDesc(e.target.value)}
                  />
                </span>
              </label>
            </div>
          </div>
          <button
            className="primary"
            disabled={
              isBusy ||
              !announceTime.trim() ||
              !announcePlatform.trim() ||
              !chosenStyle
            }
            onClick={() => {
              if (
                editingAnnounce &&
                !confirm(
                  'Are you sure you want to save? Everyone in the cohort and every reader of this paper will be notified of the change.'
                )
              ) {
                return;
              }
              run(async () => {
                const updated = await announceRoom(
                  room.id,
                  announceTime.trim(),
                  announcePlatform.trim(),
                  chosenStyle,
                  chosenStyleDesc
                );
                setEditingAnnounce(false);
                return updated;
              })();
            }}
          >
            {editingAnnounce ? 'Save changes' : 'Announce seminar'}
          </button>
          {editingAnnounce ? (
            <button onClick={() => setEditingAnnounce(false)}>Cancel</button>
          ) : (
            <button
              disabled={isBusy}
              title="Return the seminar to waiting for a host"
              onClick={run(() => unhostRoom(room.id))}
            >
              Step back from hosting
            </button>
          )}
        </div>
      )}
      {room.status === 'scheduled' && (
        <div className="stage-card scheduled">
          <p className="stage-when">{room.scheduled_time}</p>
          <p className="stage-where">{room.platform}</p>
          {room.style && (
            <p className="stage-style">
              <strong>{styleLabel(room.style)}</strong>
              {roomStyleDesc(room) && <> — {roomStyleDesc(room)}</>}
            </p>
          )}
          {isLeader && (
            <p className="stage-actions">
              <button
                className="stage-action"
                disabled={isBusy}
                onClick={startAnnounceEdit}
              >
                Edit details
              </button>
              <button
                className="stage-action"
                disabled={isBusy}
                onClick={run(() => finishRoom(room.id))}
              >
                Mark as finished
              </button>
            </p>
          )}
        </div>
      )}
      {room.status === 'finished' && (
        <div className="stage-card finished">
          <p className="stage-when">{room.scheduled_time}</p>
          <p className="stage-where">{room.platform}</p>
          {room.style && (
            <p className="stage-style">
              <strong>{styleLabel(room.style)}</strong>
            </p>
          )}
        </div>
      )}

      {room.viewer_hidden_entry_id && (
        <div className="room-hidden-note">
          Your entry is hidden.{' '}
          <button
            className="link-btn"
            disabled={isBusy}
            onClick={async () => {
              setActionError(null);
              setIsBusy(true);
              try {
                await updatePaper(room.viewer_hidden_entry_id, { marketed: true });
                onReload();
              } catch (e) {
                setActionError(e.message);
              } finally {
                setIsBusy(false);
              }
            }}
          >
            Put it on display
          </button>{' '}
          to take part.
        </div>
      )}

      {/* ---- Participants ---- */}
      <div className="room-participants">
        <h6 className="mini-title">In the cohort ({room.participants.length})</h6>
        <div className="participant-chips">
          {participants.map((u) => (
            <a
              key={u.id}
              className={leadsRoom(u) ? 'participant-chip leader' : 'participant-chip'}
              href={`#/u/${u.id}`}
              title={
                leadsRoom(u)
                  ? `${u.display_name} hosts this seminar`
                  : `Visit ${u.display_name}'s nook`
              }
            >
              <Avatar user={u} className="entry-avatar" />
              <span>{u.display_name}</span>
              {leadsRoom(u) && <span className="leader-star">★</span>}
              {u.id === currentUser.id && room.viewer_is_participant && (
                <button
                  className="chip-x"
                  title="Leave the cohort"
                  aria-label="Leave the cohort"
                  disabled={isBusy}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isLeader && room.status !== 'finished') {
                      setLeaveOpen((v) => !v);
                    } else {
                      run(() => leaveRoom(room.id))();
                    }
                  }}
                >
                  ×
                </button>
              )}
            </a>
          ))}
          {!room.viewer_is_participant && (
            <span className="hint-anchor">
              <button
                className="join-chip"
                disabled={isBusy}
                onClick={async () => {
                  setActionError(null);
                  setJoinWarning(null);
                  setIsBusy(true);
                  try {
                    onRoomChange(await joinRoom(room.id));
                  } catch (e) {
                    setJoinWarning(e.message);
                  } finally {
                    setIsBusy(false);
                  }
                }}
              >
                + Join
              </button>
              {joinWarning && (
                <HintPop
                  text={joinWarning}
                  onClose={() => setJoinWarning(null)}
                />
              )}
            </span>
          )}
        </div>
        {leaveOpen && isLeader && room.status !== 'finished' && (
          <div className="leave-handoff">
            {participants.filter((u) => u.id !== currentUser.id).length === 0 ? (
              <p className="stage-hint">
                You host this seminar and no one else is in the cohort — there
                is no one to hand hosting to, so you cannot leave yet.
              </p>
            ) : (
              <>
                <label>Hand hosting to</label>
                <select
                  value={successorId}
                  onChange={(e) => setSuccessorId(e.target.value)}
                >
                  <option value=""></option>
                  {participants
                    .filter((u) => u.id !== currentUser.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                </select>
                <button
                  className="primary"
                  disabled={isBusy || !successorId}
                  onClick={run(() => leaveRoom(room.id, parseInt(successorId)))}
                >
                  Hand over &amp; leave
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- Availability ---- */}
      {room.status !== 'scheduled' && room.status !== 'finished' && (
        <div className="room-block">
          <h6 className="mini-title">Availability</h6>

          <ul className="availability-all">
            {participants.map((u) => {
              const entry = room.availabilities.find((a) => a.user.id === u.id);
              const isMe = u.id === currentUser.id && room.viewer_is_participant;
              return (
                <li key={u.id}>
                  <Avatar user={u} className="entry-avatar" />
                  <div className="avail-body">
                    <strong>
                      {u.display_name}
                      {isMe ? ' (you)' : ''}
                    </strong>
                    {isMe ? (
                      <div className="avail-edit">
                        <input
                          type="text"
                          value={availability}
                          onChange={(e) => setAvailability(e.target.value)}
                          placeholder="e.g. weekday evenings; Fri after 3pm"
                        />
                        <button
                          className="primary"
                          disabled={
                            isBusy ||
                            !availability.trim() ||
                            availability.trim() === (entry?.availability || '')
                          }
                          onClick={run(() =>
                            setRoomAvailability(room.id, availability.trim())
                          )}
                        >
                          {entry ? 'Update' : 'Save'}
                        </button>
                      </div>
                    ) : entry ? (
                      <span className="avail-text">{entry.availability}</span>
                    ) : (
                      <span className="avail-none">
                        hasn't entered availability yet
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ---- Discussion ---- */}
      <div className="room-block">
        <h6 className="mini-title">
          Discussion{room.messages.length > 0 ? ` (${room.messages.length})` : ''}
        </h6>
        <div className="room-messages">
          {room.messages.length === 0 ? (
            <p className="no-comments">No messages yet.</p>
          ) : (
            room.messages.map((m) => (
              <div key={m.id} className="room-message">
                <Avatar user={m.user} className="entry-avatar" />
                <div className="room-message-body">
                  <p className="room-message-meta">
                    <strong>{m.user.display_name}</strong>
                    <span className="room-message-time">
                      {formatWhen(m.created_at)}
                    </span>
                  </p>
                  <p className="room-message-content">{m.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
        {room.viewer_is_participant ? (
          <div className="compose-row">
            <textarea
              className="room-textarea"
              rows="1"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a message…"
            />
            <button
              className="primary"
              disabled={isBusy || !message.trim()}
              onClick={run(async () => {
                const updated = await postRoomMessage(room.id, message.trim());
                setMessage('');
                return updated;
              })}
            >
              Send
            </button>
          </div>
        ) : (
          <div className="compose-row">
            <textarea
              className="room-textarea"
              rows="1"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a message…"
            />
            <span className="hint-anchor">
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  setMsgHint(true);
                }}
              >
                Send
              </button>
              {msgHint && (
                <HintPop
                  text={
                    room.viewer_is_reader
                      ? 'Join the cohort to post a message.'
                      : 'Add this paper to your nook (on display) to take part.'
                  }
                  onClose={() => setMsgHint(false)}
                />
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
