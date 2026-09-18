export async function activateDesktopSession(result, {
  storeToken, prepareAccount,
}) {
  await storeToken(result.token);
  try {
    await prepareAccount(result.user);
  } catch (error) {
    await storeToken(null);
    throw error;
  }
}
