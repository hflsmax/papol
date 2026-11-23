import { jsonRequest, request } from '../httpClient.js';

// Where the user last left a paper, as Papol keeps it for every place they
// read: { page, x, y, scale, read_at }, or null.
export async function getReadingPlace(sha256) {
  return (await request(`/reading-places/${sha256}`)).place;
}

// A newer place for a paper. Papol keeps whichever was read last.
export async function sendReadingPlace(sha256, place) {
  return (await jsonRequest(`/reading-places/${sha256}`, 'PUT', place)).place;
}
