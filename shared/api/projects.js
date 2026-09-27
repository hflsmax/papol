import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';

// ---------- Projects ----------

// Projects are shared, online-only state, as seminars are: Papol macOS asks
// the server for them rather than keeping them in its private replica.

// Every project, the viewer's own first. Given a paper, each of the viewer's
// projects also says whether it holds that paper (`has_paper`).
export function listProjects({ paperSha256 } = {}) {
  return request(paperSha256 ? `/projects?paper=${paperSha256}` : '/projects');
}

export function createProject(name) {
  return jsonRequest('/projects', 'POST', { name });
}

export function getProject(uuid) {
  return request(`/projects/${uuid}`);
}

export function renameProject(uuid, name) {
  return jsonRequest(`/projects/${uuid}`, 'PUT', { name });
}

export function deleteProject(uuid) {
  return request(`/projects/${uuid}`, { method: 'DELETE' });
}

export function openInvitation(uuid) {
  return request(`/projects/${uuid}/invite`, { method: 'POST' });
}

export function revokeInvitation(uuid) {
  return request(`/projects/${uuid}/invite`, { method: 'DELETE' });
}

export function previewInvitation(code) {
  return request(`/project-invites/${encodeURIComponent(code)}`);
}

export function acceptInvitation(code) {
  return request(`/project-invites/${encodeURIComponent(code)}`, { method: 'POST' });
}

export function setKeeper(uuid, userUuid, isKeeper) {
  return jsonRequest(`/projects/${uuid}/members/${userUuid}`, 'PUT', { is_keeper: isKeeper });
}

export function removeMember(uuid, userUuid) {
  return request(`/projects/${uuid}/members/${userUuid}`, { method: 'DELETE' });
}

// The paper has to be on the server before a project can hold it, so on the
// Mac a copy made offline is published first.
export function addPaperToProject(uuid, paperSha256) {
  return onServer(() => jsonRequest(`/projects/${uuid}/papers`, 'POST', { paper_sha256: paperSha256 }), { pull: false });
}

export function removePaperFromProject(uuid, paperSha256) {
  return request(`/projects/${uuid}/papers/${paperSha256}`, { method: 'DELETE' });
}

// A board the project holds, made by the member who asks.
export function createProjectBoard(uuid, name) {
  return jsonRequest(`/projects/${uuid}/boards`, 'POST', { name });
}

// ---------- Discussions ----------

// A subject's discussion, if it has one, and what it is about.
export function findDiscussion(projectUuid, { paper, card }) {
  return request(`/projects/${projectUuid}/discussion?${paper ? `paper=${paper}` : `card=${card}`}`);
}

// The first post on a subject, or the next one if it has a discussion.
export function startDiscussion(projectUuid, { paper, card }, body) {
  return jsonRequest(`/projects/${projectUuid}/discussions`, 'POST', paper ? { paper_sha256: paper, body } : { board_item_uuid: card, body });
}

export function getDiscussion(uuid) {
  return request(`/discussions/${uuid}`);
}

export function replyToDiscussion(uuid, body) {
  return jsonRequest(`/discussions/${uuid}/posts`, 'POST', { body });
}

export function editDiscussionPost(uuid, body) {
  return jsonRequest(`/discussion-posts/${uuid}`, 'PUT', { body });
}

export function deleteDiscussionPost(uuid) {
  return request(`/discussion-posts/${uuid}`, { method: 'DELETE' });
}

// Where "Discuss" on a subject leads, on this deployment.
export function discussPath(projectUuid, { paper, card }) {
  return `/project/${projectUuid}/discuss/${paper ? `paper/${paper}` : `card/${card}`}`;
}

// Where an invitation link leads, on this deployment.
export function invitationPath(code) {
  return `/projects/join/${code}`;
}
