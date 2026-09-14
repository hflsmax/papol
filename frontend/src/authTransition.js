export async function activateDesktopSession(result, {
  storeToken, prepareAccount,
}) {
  await storeToken(result.token, result.user.uuid);
  try {
    await prepareAccount(result.user);
  } catch (error) {
    await storeToken(null, result.user.uuid);
    throw error;
  }
}
