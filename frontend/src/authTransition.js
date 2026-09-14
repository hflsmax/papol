export async function activateDesktopSession(result, {
  rememberIdentity, storeToken, prepareAccount,
}) {
  await rememberIdentity(result.token, result.user).catch(() => {});
  await storeToken(result.token, result.user.uuid);
  try {
    await prepareAccount(result.user);
  } catch (error) {
    await storeToken(null, result.user.uuid);
    throw error;
  }
}
