import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';

// ---------- Seminar rooms ----------

export function callSeminar(paperUuid) {
  return onServer(() => request(`/papers/${paperUuid}/room`, { method: 'POST' }));
}

// Seminar rooms are shared, online-only state in Papol macOS rather than
// rows in its private offline replica. The paper endpoint is the canonical
// source for the summaries shown beside a paper.
export async function listPaperRooms(paperUuid) {
  const paper = await request(`/papers/${paperUuid}`);
  return paper.rooms || [];
}

export function getRoom(roomUuid) {
  return request(`/rooms/${roomUuid}`);
}

export function leadRoom(roomUuid) {
  return onServer(() => request(`/rooms/${roomUuid}/lead`, { method: 'POST' }));
}

export function joinRoom(roomUuid) {
  return onServer(() => request(`/rooms/${roomUuid}/join`, { method: 'POST' }));
}

export function unhostRoom(roomUuid) {
  return onServer(() => request(`/rooms/${roomUuid}/unhost`, { method: 'POST' }));
}

export function uncallSeminar(roomUuid) {
  return onServer(() => request(`/rooms/${roomUuid}/uncall`, { method: 'POST' }));
}

export function leaveRoom(roomUuid, successorUuid = null) {
  return onServer(() => jsonRequest(`/rooms/${roomUuid}/leave`, 'POST', {
    successor_uuid: successorUuid,
  }));
}

export function postRoomMessage(roomUuid, content) {
  return onServer(() => jsonRequest(`/rooms/${roomUuid}/messages`, 'POST', { content }));
}

export function setRoomAvailability(roomUuid, availability) {
  return onServer(() => jsonRequest(`/rooms/${roomUuid}/availability`, 'POST', { availability }));
}

export function finishRoom(roomUuid) {
  return onServer(() => request(`/rooms/${roomUuid}/finish`, { method: 'POST' }));
}

export function announceRoom(roomUuid, scheduledTime, platform, style, styleDesc = null) {
  return onServer(() => jsonRequest(`/rooms/${roomUuid}/announce`, 'PUT', {
    scheduled_time: scheduledTime,
    platform,
    style,
    style_desc: styleDesc,
  }));
}
