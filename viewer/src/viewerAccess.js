export function canOpenPrivateSource({ requiresSignIn, token, localAccount }) {
  return !requiresSignIn || Boolean(token) || Boolean(localAccount);
}
