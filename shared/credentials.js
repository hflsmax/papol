import { IS_DESKTOP } from './appEnvironment.js';

const TOKEN_KEY = 'papol_token';
const ACCOUNT_KEY = 'papol.localAccountId';
let memoryToken = null;
let nativeInvoke = null;

export function configureCredentialInvoke(invoke) {
  if (typeof invoke !== 'function') throw new TypeError('Credential invoke must be a function');
  nativeInvoke = invoke;
}

function invokeCredential(command, arguments_) {
  if (!nativeInvoke) throw new Error('Native credential storage is not configured');
  return nativeInvoke(command, arguments_);
}

function storage() {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function accountId() {
  const value = Number(storage()?.getItem(ACCOUNT_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function currentCredential() {
  return memoryToken;
}

export async function hydrateCredential() {
  const local = storage();
  const legacy = local?.getItem(TOKEN_KEY) || null;
  if (!IS_DESKTOP) {
    memoryToken = legacy;
    return memoryToken;
  }
  const account = accountId();
  if (account == null) {
    memoryToken = legacy;
    return memoryToken;
  }
  if (legacy) {
    memoryToken = legacy;
    await invokeCredential('credential_set', { accountId: account, token: legacy });
    local.removeItem(TOKEN_KEY);
    return memoryToken;
  }
  memoryToken = await invokeCredential('credential_get', { accountId: account });
  return memoryToken;
}

export async function storeCredential(token, explicitAccountId = null) {
  memoryToken = token || null;
  const local = storage();
  if (!IS_DESKTOP) {
    if (token) local?.setItem(TOKEN_KEY, token);
    else local?.removeItem(TOKEN_KEY);
    return;
  }
  const account = explicitAccountId ?? accountId();
  if (account != null) {
    await invokeCredential('credential_set', { accountId: account, token: token || '' });
  }
  local?.removeItem(TOKEN_KEY);
}
