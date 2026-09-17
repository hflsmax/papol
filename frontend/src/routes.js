import { stripAppBase } from './base.js';

// What a name looks like in a URL. Users and seminar rooms are addressed by
// their UUID. A paper is addressed by the digest of its PDF, because a paper
// *is* its file: the bytes say which paper a link means, and a paper has no
// other name to be addressed by.
const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const DIGEST = '([0-9a-f]{64})';

// Which page a path asks for. Pure in its argument so that the link someone
// was handed can be tested without a browser: routes.test.js walks every
// shape below, and a name that changes shape has to be answered here.
export function parseRoute(pathname = window.location.pathname || '/') {
  const rawPath = stripAppBase(pathname || '/');
  const demo = rawPath === '/demo' || rawPath.startsWith('/demo/');
  const path = demo
    ? rawPath === '/demo' ? '/' : rawPath.slice('/demo'.length)
    : rawPath;
  const routed = (route) => ({
    ...route,
    ...(demo ? { demo: true } : {}),
  });
  const at = (pattern) => path.match(new RegExp(`^${pattern}/?$`, 'i'))?.[1].toLowerCase();
  let uuid;
  if ((uuid = at(`/u/${UUID}/boards`))) return routed({ page: 'space', uuid, section: 'boards' });
  if ((uuid = at(`/u/${UUID}`))) return routed({ page: 'space', uuid });
  if ((uuid = at(`/paper/${DIGEST}`))) return routed({ page: 'paper', uuid });
  if ((uuid = at(`/room/${UUID}`))) return routed({ page: 'room', uuid });
  if (path === '/profile') return routed({ page: 'profile' });
  if (path === '/join') return routed({ page: 'join' });
  if (path === '/about') return routed({ page: 'about' });
  if (path === '/learn') return routed({ page: 'learn' });
  if (path === '/signin') return routed({ page: 'signin' });
  if (path === '/library' || path === '/papers') return routed({ page: 'papers' });
  if (path === '/village' || path === '/users') return routed({ page: 'papers' });
  if (path === '/inbox') return routed({ page: 'inbox' });
  if (path === '/admin') return routed({ page: 'admin' });
  return routed({ page: 'home' });
}
