export default defineEventHandler(async (event) => {
  const { code, state } = await readBody(event);

  if (!code || !state) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing code or state",
    });
  }

  const authUrl = useRuntimeConfig().public.authPath?.replace(/\/auth\/?$/, "");
  const response = await $fetch(`${authUrl}/auth/token`, {
    method: "POST",
    body: { code, state },
  });

  if (!response?.token) {
    throw createError({
      statusCode: 401,
      statusMessage: "Auth exchange failed",
    });
  }

  return { token: response.token };
});
