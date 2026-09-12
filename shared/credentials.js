const TOKEN_KEY = 'papol_token';
let memoryToken = null;

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function currentCredential() {
  return memoryToken;
}

export async function hydrateCredential() {
  memoryToken = storage()?.getItem(TOKEN_KEY) || null;
  return memoryToken;
}

export async function storeCredential(token) {
  memoryToken = token || null;
  const local = storage();
  if (token) local?.setItem(TOKEN_KEY, token);
  else local?.removeItem(TOKEN_KEY);
}
