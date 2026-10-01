import { stripAppBase } from './base.js';
import { PAPER_NAME_PATTERN } from '../../shared/paperName.js';

// What a name looks like in a URL. Users, boards and projects are addressed
// by their UUID. A paper is addressed by the digest of its PDF, because a paper
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
  // A paper picked from a shelf or a board: the same paper, the place it was
  // picked from kept in front of it so the nook's rail keeps that place chosen.
  const picked = path.match(new RegExp(`^/(shelf|board)/${UUID}/paper/${PAPER}/?$`, 'i'));
  if (picked) return { page: 'paper', uuid: picked[3].toLowerCase(), [picked[1].toLowerCase()]: picked[2].toLowerCase() };
  if ((uuid = at(`/shelf/${UUID}`))) return { page: 'shelf', uuid };
  if ((uuid = at(`/board/${UUID}`))) return { page: 'board', uuid };
  if ((uuid = at(`/project/${UUID}`))) return { page: 'project', uuid };
  // A board opened inside a project: its jacket in the project's frame.
  const inProject = path.match(new RegExp(`^/project/${UUID}/board/${UUID}/?$`, 'i'));
  if (inProject) return { page: 'project', uuid: inProject[1].toLowerCase(), board: inProject[2].toLowerCase() };
  // An invitation's code is case-sensitive, so it is read as written.
  const invitation = path.match(/^\/projects\/join\/([0-9A-Za-z]{10})\/?$/)?.[1];
  if (invitation) return { page: 'invitation', code: invitation };
  if (path === '/projects') return { page: 'projects' };
  if (path === '/profile') return { page: 'profile' };
  if (path === '/join') return { page: 'join' };
  if (path === '/about') return { page: 'about' };
  if (path === '/learn') return { page: 'learn' };
  if (path === '/signin') return { page: 'signin' };
  const resetToken = path.match(/^\/reset-password\/([0-9a-f]{64})\/?$/i)?.[1];
  if (resetToken) return { page: 'reset-password', token: resetToken.toLowerCase() };
  if (path === '/bazaar' || path === '/library') return { page: 'papers' };
  if (path === '/inbox') return { page: 'inbox' };
  if (path === '/admin') return { page: 'admin' };
  // The page file itself is where the Mac app's window opens.
  if (path === '/' || path === '/index.html') return { page: 'home' };
  // No page answers this path: a link that leads nowhere is a bug to report,
  // not a reason to show some other page as if it were asked for.
  return { page: 'unknown', path };
}
