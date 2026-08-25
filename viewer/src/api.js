// The viewer is its own app but not its own world: it runs on Papol's
// origin and carries the same session token, so there is no second sign-in
// and no second idea of who a reader is.
// Both /viewer and /demo/viewer run this build. Step back once from the
// former and twice from the latter to reach Papol's root API and assets.
const ROOT = window.location.pathname.includes('/demo/viewer') ? '../..' : '..';
const API_BASE = `${ROOT}/api`;
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

export function getPaperByPdf(hash) {
  return request(`/viewer/${hash}`);
}

export function pdfHref(paper) {
  if (!paper?.file_path) return null;
  if (paper.file_path.startsWith('http')) return paper.file_path;
  // Demo papers are shipped with the app; uploaded ones live in /uploads.
  if (paper.file_path.startsWith('assets/')) return `${ROOT}/${paper.file_path}`;
  return `${ROOT}/uploads/${paper.file_path}`;
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

export function clearPlace(id) {
  return jsonRequest(`/comments/${id}`, 'PUT', { current_place: false });
}

export function deleteNote(id) {
  return request(`/comments/${id}`, { method: 'DELETE' });
}

// ---- References ----

// The bibliography of the PDF being read, and where each work is cited in
// it. The first ask may answer `pending`: reading a PDF's references takes
// a pass over the whole document, which happens once and is then kept.
export function getViewerReferences(pdfHash, editionId) {
  return request(`/viewer-references/${pdfHash}?edition_id=${editionId}`);
}

// One reference, looked up the first time anyone opens it.
export function getViewerReference(id) {
  return request(`/viewer-references/item/${id}`);
}

export function resolveViewerReference(pdfHash, { key, raw }) {
  return jsonRequest(`/viewer-references/${pdfHash}/preview`, 'POST', { key, raw });
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

export function moveInk(strokeId, points) {
  return jsonRequest(`/ink/${strokeId}`, 'PUT', { points });
}

export function eraseInk(strokeId) {
  return request(`/ink/${strokeId}`, { method: 'DELETE' });
}

// ---- Feedback ----

export function submitFeedback({ content, page, contact }) {
  return jsonRequest('/feedback', 'POST', {
    content,
    page: page || null,
    contact: contact || null,
  });
}
