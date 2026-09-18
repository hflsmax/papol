import {
  boardView, nativeAccountUuid, nativeDataActive, nativeRepository, paperView, shelfView,
} from '../nativeData.js';
import { request } from '../httpClient.js';
import { rememberPaperIdentity } from './paperState.js';

// ---------- Users / nooks ----------

export function listUsers() {
  return request('/users');
}

export async function getNook(userUuid) {
  if (nativeDataActive() && userUuid === nativeAccountUuid()) {
    const [user, boards, nook, localPapers] = await Promise.all([
      nativeRepository.account(), nativeRepository.boards(), nativeRepository.nook(), nativeRepository.papers(),
    ]);
    const papers = localPapers.map((row) => rememberPaperIdentity(paperView(row)));
    return {
      user,
      papers,
      boards: boards.map((row) => boardView(row)),
      shelves: nook.shelves.map(shelfView),
      tags: nook.tags,
    };
  }
  const nook = await request(`/users/${userUuid}/nook`);
  nook.papers.forEach(rememberPaperIdentity);
  return nook;
}
