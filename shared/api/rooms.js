import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';

// ---------- Seminar rooms ----------

export function callSeminar(paperUuid) {
  return onServer(() => request(`/papers/${paperUuid}/room`, { method: 'POST' }), { pull: false });
}

export function getRoom(roomUuid) {
  return request(`/rooms/${roomUuid}`);
}

export function leadRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/lead`, { method: 'POST' });
}

export function joinRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/join`, { method: 'POST' });
}

export function unhostRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/unhost`, { method: 'POST' });
}

export function leaveRoom(roomUuid, successorUuid = null) {
  return jsonRequest(`/rooms/${roomUuid}/leave`, 'POST', {
    successor_uuid: successorUuid,
  });
}

export function postRoomMessage(roomUuid, content) {
  return jsonRequest(`/rooms/${roomUuid}/messages`, 'POST', { content });
}

export function setRoomAvailability(roomUuid, availability) {
  return jsonRequest(`/rooms/${roomUuid}/availability`, 'POST', { availability });
}

export function finishRoom(roomUuid) {
  return request(`/rooms/${roomUuid}/finish`, { method: 'POST' });
}

export function announceRoom(roomUuid, scheduledTime, platform, style, styleDesc = null) {
  return jsonRequest(`/rooms/${roomUuid}/announce`, 'PUT', {
    scheduled_time: scheduledTime,
    platform,
    style,
    style_desc: styleDesc,
  });
}
