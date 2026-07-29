export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, "authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return;
  }

  const token = authHeader.slice(7);
  if (!token) return;

  try {
    const authUrl = useRuntimeConfig().public.authPath?.replace(
      /\/auth\/?$/,
      "",
    );
    if (!authUrl) return;

    const response = await $fetch(`${authUrl}/auth/verify`, {
      method: "POST",
      body: { token },
    });

    if (response?.user) {
      event.context.user = response.user;
      event.context.token = token;
    }
  } catch {}
});
