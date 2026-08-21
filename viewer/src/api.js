// The viewer is its own app but not its own world: it runs on Papol's
// origin and carries the same session token, so there is no second sign-in
// and no second idea of who a reader is.
const API_BASE = '../api';
const TOKEN_KEY = 'papol_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try {
      message = (await response.json()).detail || message;
    } catch {
      /* keep the status */
    }
    const err = new Error(typeof message === 'string' ? message : JSON.stringify(message));
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function jsonRequest(path, method, body) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getPaper(id) {
  return request(`/papers/${id}`);
}

export function pdfHref(paper) {
  if (!paper?.file_path) return null;
  if (paper.file_path.startsWith('http')) return paper.file_path;
  // Demo papers are shipped with the app; uploaded ones live in /uploads.
  if (paper.file_path.startsWith('assets/')) return `../${paper.file_path}`;
  return `../uploads/${paper.file_path}`;
}

// A located note is a note: the same endpoints Papol's own notes use, with
// a page and an anchor attached.
export function createNote(paperId, { page, anchor, content }) {
  return jsonRequest(`/papers/${paperId}/comments`, 'POST', { page, anchor, content });
}

export function updateNote(id, content) {
  return jsonRequest(`/comments/${id}`, 'PUT', { content });
}

export function moveNote(id, { page, anchor }) {
  return jsonRequest(`/comments/${id}`, 'PUT', { page, anchor });
}

export function renameNote(id, name) {
  return jsonRequest(`/comments/${id}`, 'PUT', { name });
}

export function markPlace(id) {
  return jsonRequest(`/comments/${id}`, 'PUT', { current_place: true });
}

export function deleteNote(id) {
  return request(`/comments/${id}`, { method: 'DELETE' });
}

// ---- References ----

// The bibliography of the PDF being read, and where each work is cited in
// it. The first ask may answer `pending`: reading a PDF's references takes
// a pass over the whole document, which happens once and is then kept.
export function getReferences(editionId, { refresh = false } = {}) {
  return request(`/editions/${editionId}/references${refresh ? '?refresh=true' : ''}`);
}

// One reference, looked up the first time anyone opens it.
export function getReference(id) {
  return request(`/references/${id}`);
}

// ---- Ink ----

// What the reader has drawn on this edition. Kept per edition, like the
// references: the marks were made over a particular PDF.
export function getInk(editionId) {
  return request(`/editions/${editionId}/ink`);
}

export function addInk(editionId, stroke) {
  return jsonRequest(`/editions/${editionId}/ink`, 'POST', stroke);
}

export function eraseInk(strokeId) {
  return request(`/ink/${strokeId}`, { method: 'DELETE' });
}
