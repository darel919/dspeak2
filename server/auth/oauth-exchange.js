const oauthExchangeTimeoutMs = 20_000;

export async function exchangeOAuthCode(client, code) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("OAuth provider did not respond in time")),
      oauthExchangeTimeoutMs,
    );
  });

  try {
    return await Promise.race([
      client.auth.exchangeCodeForSession(code),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
