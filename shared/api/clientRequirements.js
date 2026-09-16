import { request } from '../httpClient.js';

// What the server asks of this build. Unauthenticated on purpose: the
// answer has to reach a reader who is signed out, or whose credential has
// just been refused, because that is often the same reader whose app is
// too old to sign in with.
export function getClientRequirements() {
  return request('/client-requirements');
}
