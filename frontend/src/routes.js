import { stripAppBase } from './base.js';
import { PAPER_NAME_PATTERN } from '../../shared/paperName.js';

// What a name looks like in a URL. Users and seminar rooms are addressed by
// their UUID. A paper is addressed by the digest of its PDF, because a paper
// *is* its file: the bytes say which paper a link means, and a paper has no
// other name to be addressed by. It goes by the first half of that digest,
// which is the same size as a UUID.
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const PAPER = `(${PAPER_NAME_PATTERN})`;

// Which page a path asks for. Pure in its argument so that the link someone
// was handed can be tested without a browser: routes.test.js walks every
// shape below, and a name that changes shape has to be answered here.
export function parseRoute(pathname = window.location.pathname || '/') {
  const path = stripAppBase(pathname || '/');
  const at = (pattern) => path.match(new RegExp(`^${pattern}/?$`, 'i'))?.[1].toLowerCase();
  let uuid;
  if ((uuid = at(`/u/${UUID}/boards`))) return { page: 'nook', uuid, section: 'boards' };
  if ((uuid = at(`/u/${UUID}`))) return { page: 'nook', uuid };
  if ((uuid = at(`/paper/${PAPER}`))) return { page: 'paper', uuid };
  if ((uuid = at(`/board/${UUID}`))) return { page: 'board', uuid };
  if ((uuid = at(`/room/${UUID}`))) return { page: 'room', uuid };
  if (path === '/profile') return { page: 'profile' };
  if (path === '/join') return { page: 'join' };
  if (path === '/about') return { page: 'about' };
  if (path === '/learn') return { page: 'learn' };
  if (path === '/signin') return { page: 'signin' };
  if (path === '/library') return { page: 'papers' };
  if (path === '/inbox') return { page: 'inbox' };
  if (path === '/admin') return { page: 'admin' };
  return { page: 'home' };
}
