import React, { useState } from 'react';
import { appPath } from '../base';
import {
  leadRoom,
  joinRoom,
  leaveRoom,
  unhostRoom,
  uncallSeminar,
  postRoomMessage,
  setRoomAvailability,
  announceRoom,
  finishRoom,
} from '../../../shared/api/rooms.js';
import appLimits from '../../../shared/appLimits.js';
import Avatar from './Avatar';
import HintPop from './HintPop';
import { SEMINAR_STYLES, canUncall, roomStyleDesc, styleLabel } from '../seminarStyles';
import { confirmAction } from '../../../shared/confirmAction';

function formatWhen(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// The interactive body of a seminar room.
export default function RoomView({ room, currentUser, onRoomChange, onReload, onUncalled }) {
  const [actionError, setActionError] = useState(null);
  const [message, setMessage] = useState('');
  const [availability, setAvailability] = useState(() => {
    const mine = room.availabilities.find((a) => a.user.uuid === currentUser.uuid);
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
  const [successorUuid, setSuccessorUuid] = useState('');

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

  const isLeader = room.leader && room.leader.uuid === currentUser.uuid;
  const myAvail = room.availabilities.find((a) => a.user.uuid === currentUser.uuid);

  const leadsRoom = (u) => room.leader && u.uuid === room.leader.uuid;
  const participants = [...room.participants].sort(
    (a, b) => leadsRoom(b) - leadsRoom(a)
  );
  const isParticipant = room.participants.some((p) => p.uuid === currentUser.uuid);
  const uncallable = canUncall(room, currentUser);

  const uncall = async () => {
    if (!(await confirmAction('Uncall this seminar? The empty cohort will be removed.', {
      confirmLabel: 'Uncall seminar',
      destructive: true,
    }))) return;
    setActionError(null);
    setIsBusy(true);
    try {
      await uncallSeminar(room.uuid);
      onUncalled();
    } catch (e) {
      setActionError(e.message);
      setIsBusy(false);
    }
  };

  return (
    <div className="room-view">
      {actionError && <div className="error" role="alert">{actionError}</div>}

      {/* ---- Stage ---- */}
      {room.status === 'open' && (
        <div className="stage-card open">
          <h5>Seminar called — waiting for a leader</h5>
          <p>Called by {room.creator.display_name}.</p>
          <p className="stage-hint">
            The leader is the seminar's benevolent dictator: they volunteer to
            plan its time, place, and style, and to lead the discussion.
          </p>
          {room.viewer_copy_is_public ? (
            <span className="hint-anchor">
              <button
                className="primary stage-action"
                disabled={isBusy}
                onClick={async () => {
                  setActionError(null);
                  setLeadWarning(null);
                  setIsBusy(true);
                  try {
                    onRoomChange(await leadRoom(room.uuid));
                  } catch (e) {
                    setLeadWarning(e.message);
                  } finally {
                    setIsBusy(false);
                  }
                }}
              >
                Lead this seminar
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
              Only users with this paper on a public shelf can lead.
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
              <label htmlFor="seminar-time">Time</label>
              <input
                id="seminar-time"
                type="text"
                value={announceTime}
                onChange={(e) => setAnnounceTime(e.target.value)}
                placeholder="e.g. Friday Aug 22, 4:00 pm CET"
              />
            </div>
            <div className="form-group">
              <label htmlFor="seminar-platform">Platform / place</label>
              <input
                id="seminar-platform"
                type="text"
                value={announcePlatform}
                onChange={(e) => setAnnouncePlatform(e.target.value)}
                placeholder="e.g. Zoom link, seminar room 2.13"
              />
            </div>
          </div>
          <div className="form-group">
            <div className="form-label" id="seminar-style-label">Style</div>
            <div className="style-options" role="radiogroup" aria-labelledby="seminar-style-label">
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
                    maxLength={appLimits.text.room_style}
                    placeholder="title, e.g. Socratic dialogue"
                    onFocus={() => setAnnounceStyle('custom')}
                    onChange={(e) => setCustomStyle(e.target.value)}
                  />
                  <input
                    type="text"
                    className="style-custom-input"
                    value={customStyleDesc}
                    maxLength={appLimits.text.room_style_description}
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
            onClick={async () => {
              if (
                editingAnnounce &&
                !(await confirmAction(
                  'Are you sure you want to save? Everyone in the cohort and every user of this paper will be notified of the change.',
                  { confirmLabel: 'Save and notify' },
                ))
              ) {
                return;
              }
              run(async () => {
                const updated = await announceRoom(
                  room.uuid,
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
              title="Return the seminar to waiting for a leader"
              onClick={run(() => unhostRoom(room.uuid))}
            >
              Step back from leading
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
                onClick={run(() => finishRoom(room.uuid))}
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

      {/* ---- Participants ---- */}
      <div className="room-participants">
        <h6 className="mini-title">In the cohort ({room.participants.length})</h6>
        <div className="participant-chips">
          {participants.map((u) => (
            <a
              key={u.uuid}
              className={leadsRoom(u) ? 'participant-chip leader' : 'participant-chip'}
              href={appPath(`/u/${u.uuid}`)}
              title={
                leadsRoom(u)
                  ? `${u.display_name} hosts this seminar`
                  : `Visit ${u.display_name}'s nook`
              }
            >
              <Avatar user={u} className="entry-avatar" />
              <span>{u.display_name}</span>
              {leadsRoom(u) && <span className="leader-star">★</span>}
              {u.uuid === currentUser.uuid && isParticipant && (
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
                      run(() => leaveRoom(room.uuid))();
                    }
                  }}
                >
                  ×
                </button>
              )}
            </a>
          ))}
          {!isParticipant && (
            <span className="hint-anchor">
              <button
                className="join-chip"
                disabled={isBusy}
                onClick={async () => {
                  setActionError(null);
                  setJoinWarning(null);
                  setIsBusy(true);
                  try {
                    onRoomChange(await joinRoom(room.uuid));
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
            {participants.filter((u) => u.uuid !== currentUser.uuid).length === 0 ? (
              <>
                <p className="stage-hint">
                  You host this seminar and no one else is in the cohort — there
                  is no one to hand hosting to.
                </p>
                {uncallable && (
                  <button
                    type="button"
                    className="danger"
                    disabled={isBusy}
                    onClick={uncall}
                  >
                    Uncall seminar
                  </button>
                )}
              </>
            ) : (
              <>
                <label htmlFor="seminar-successor">Hand hosting to</label>
                <select
                  id="seminar-successor"
                  value={successorUuid}
                  onChange={(e) => setSuccessorUuid(e.target.value)}
                >
                  <option value=""></option>
                  {participants
                    .filter((u) => u.uuid !== currentUser.uuid)
                    .map((u) => (
                      <option key={u.uuid} value={u.uuid}>
                        {u.display_name}
                      </option>
                    ))}
                </select>
                <button
                  className="primary"
                  disabled={isBusy || !successorUuid}
                  onClick={run(() => leaveRoom(room.uuid, successorUuid))}
                >
                  Hand over &amp; leave
                </button>
              </>
            )}
          </div>
        )}
        {canUncall && !leaveOpen && (
          <button
            type="button"
            className="danger"
            disabled={isBusy}
            onClick={uncall}
          >
            Uncall seminar
          </button>
        )}
      </div>

      {/* ---- Availability ---- */}
      {room.status !== 'scheduled' && room.status !== 'finished' && (
        <div className="room-block">
          <h6 className="mini-title">Availability</h6>

          <ul className="availability-all">
            {participants.map((u) => {
              const entry = room.availabilities.find((a) => a.user.uuid === u.uuid);
              const isMe = u.uuid === currentUser.uuid && isParticipant;
              return (
                <li key={u.uuid}>
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
                            setRoomAvailability(room.uuid, availability.trim())
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
        <ol className="room-messages" aria-label="Discussion messages">
          {room.messages.length === 0 ? (
            <li className="no-comments">No messages yet.</li>
          ) : (
            room.messages.map((m) => (
              <li key={m.uuid} className="room-message">
                <Avatar user={m.user} className="entry-avatar" />
                <div className="room-message-body">
                  <header className="room-message-meta">
                    <strong>{m.user.display_name}</strong>
                    <time className="room-message-time" dateTime={m.created_at}>
                      {formatWhen(m.created_at)}
                    </time>
                  </header>
                  <p className="room-message-content">{m.content}</p>
                </div>
              </li>
            ))
          )}
        </ol>
        {isParticipant ? (
          <form
            className="compose-row"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                const updated = await postRoomMessage(room.uuid, message.trim());
                setMessage('');
                return updated;
              })();
            }}
          >
            <textarea
              className="room-textarea"
              rows="1"
              aria-label="Message"
              maxLength={appLimits.text.room_message}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write a message…"
            />
            <button
              type="submit"
              className="primary"
              disabled={isBusy || !message.trim()}
            >
              Send
            </button>
          </form>
        ) : (
          <div className="compose-row">
            <textarea
              className="room-textarea"
              rows="1"
              aria-label="Message"
              maxLength={appLimits.text.room_message}
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
                    room.viewer_copy_is_public
                      ? 'Join the cohort to post a message.'
                      : 'Move this paper to a public shelf to take part.'
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
