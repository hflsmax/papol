import {
  boardView, nativeAccountUuid, nativeDataActive, nativeRepository, paperView, shelfView,
} from '../nativeData.js';
import { request } from '../httpClient.js';
import { rememberPaperIdentity } from './paperState.js';

// ---------- Users / spaces ----------

export function listUsers() {
  return request('/users');
}

export async function getUserSpace(userUuid) {
  if (nativeDataActive() && userUuid === nativeAccountUuid()) {
    const [user, boards, nook, localPapers] = await Promise.all([
      nativeRepository.account(), nativeRepository.boards(), nativeRepository.nook(), nativeRepository.papers(),
    ]);
    return {
      user,
      papers: localPapers.map((row) => paperView(row)),
      boards: boards.map((row) => boardView(row)),
      shelves: nook.shelves.map(shelfView),
      tags: nook.tags,
    };
  }
  const space = await request(`/users/${userUuid}/space`);
  (space.papers || []).forEach(rememberPaperIdentity);
  return space;
}
