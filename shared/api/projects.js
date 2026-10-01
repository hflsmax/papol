import { jsonRequest, request } from '../httpClient.js';
import { onServer } from './serverOperation.js';
import { paperName } from '../paperName.js';

// ---------- Projects ----------

// Projects are shared, online-only state: Papol macOS asks
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

// Renewed only while an authenticated Papol window is visible. Other members
// learn the result through their ordinary project refreshes.
export function markPresent() {
  return request('/presence', { method: 'POST' });
}

export function renameProject(uuid, name) {
  return jsonRequest(`/projects/${uuid}`, 'PUT', { name });
}

export function describeProject(uuid, description) {
  return jsonRequest(`/projects/${uuid}`, 'PUT', { description });
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

// People in Papol a keeper can add, found by name or whole address.
export function findPeople(uuid, query) {
  return request(`/projects/${uuid}/people?q=${encodeURIComponent(query)}`);
}

export function addMember(uuid, userUuid) {
  return jsonRequest(`/projects/${uuid}/members`, 'POST', { user_uuid: userUuid });
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

// The shared vocabulary of a project, and its many-to-many assignments to
// the papers the project holds. These stay online with the project rather
// than entering any member's private replica.
export function createProjectTag(uuid, name) {
  return jsonRequest(`/projects/${uuid}/tags`, 'POST', { name });
}

export function renameProjectTag(uuid, tagUuid, name) {
  return jsonRequest(`/projects/${uuid}/tags/${tagUuid}`, 'PUT', { name });
}

export function deleteProjectTag(uuid, tagUuid) {
  return request(`/projects/${uuid}/tags/${tagUuid}`, { method: 'DELETE' });
}

export function addProjectPaperTag(uuid, paperSha256, tagUuid) {
  return request(`/projects/${uuid}/papers/${paperSha256}/tags/${tagUuid}`, { method: 'POST' });
}

export function removeProjectPaperTag(uuid, paperSha256, tagUuid) {
  return request(`/projects/${uuid}/papers/${paperSha256}/tags/${tagUuid}`, { method: 'DELETE' });
}

// A board the project holds, made by the member who asks.
export function createProjectBoard(uuid, name) {
  return jsonRequest(`/projects/${uuid}/boards`, 'POST', { name });
}

// ---------- Digs ----------

// A dig is about a paper, a card or an annotation, named by a key:
// "paper:<sha256>", "card:<uuid>" or "annotation:<uuid>".
export function subjectKey(subject) {
  if (typeof subject === 'string') return subject;
  if (subject.paper) return `paper:${subject.paper}`;
  if (subject.card) return `card:${subject.card}`;
  return `annotation:${subject.annotation}`;
}

// A paper with the project on: every member's annotations on it, whose
// each is, and the digs open on them. What the viewer reads once a
// project is chosen.
export function listProjectAnnotations(uuid, paperSha256) {
  return request(`/projects/${uuid}/papers/${paperSha256}/annotations`);
}

// Every dig on a subject (one per member who started one), the reader's
// own among them, and what it is about. With no project, the reader's own
// personal dig on it, if any: nobody else sees it.
export function findDigs(projectUuid, subject) {
  const query = `digs?subject=${encodeURIComponent(subjectKey(subject))}`;
  return request(projectUuid ? `/projects/${projectUuid}/${query}` : `/${query}`);
}

// Digging a subject: the member's own dig on it, with its text. With no
// project, a personal dig.
export function startDig(projectUuid, subject, text) {
  return jsonRequest(projectUuid ? `/projects/${projectUuid}/digs` : '/digs', 'POST', { subject: subjectKey(subject), text });
}

// The reader's personal digs on a paper: pins by annotation, and the one on
// the paper itself.
export function personalDigsOn(paperSha256) {
  return request(`/papers/${paperName(paperSha256)}/digs`);
}

// Its owner rewords a dig.
export function editDig(uuid, text) {
  return jsonRequest(`/digs/${uuid}`, 'PUT', { text });
}

// Its owner, or a keeper, removes a dig and all posted in it.
export function removeDig(uuid) {
  return request(`/digs/${uuid}`, { method: 'DELETE' });
}

// Anyone in the project moves a dig from one phase to another.
export function moveDig(uuid, phase) {
  return jsonRequest(`/digs/${uuid}/phase`, 'PUT', { phase });
}

export function getDig(uuid) {
  return request(`/digs/${uuid}`);
}

// A post in any dig, whoever's it is.
export function postInDig(uuid, body) {
  return jsonRequest(`/digs/${uuid}/posts`, 'POST', { body });
}

export function editPost(uuid, body) {
  return jsonRequest(`/dig-posts/${uuid}`, 'PUT', { body });
}

export function deletePost(uuid) {
  return request(`/dig-posts/${uuid}`, { method: 'DELETE' });
}

// The viewer with the project on: the paper, or one annotation on it with
// a dig on that annotation open beside it.
export function annotationViewerPath(projectUuid, paperSha256, { annotation = null, dig = null } = {}) {
  return `/viewer/?pdf=${paperSha256}&project=${projectUuid}${annotation ? `&annotation=${annotation}` : ''}${annotation && dig ? `&dig=${dig}` : ''}`;
}


// Where an invitation link leads, on this deployment.
export function invitationPath(code) {
  return `/projects/join/${code}`;
}
