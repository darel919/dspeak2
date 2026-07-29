import { useAuthStore } from "../stores/auth";

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server || to.path === "/auth") return;

  const authStore = useAuthStore();
  const authenticated = await authStore.ensureSession();
  const publicEntry =
    to.path === "/" ||
    to.path === "/privacy" ||
    to.path === "/terms" ||
    String(to.path || "").startsWith("/join/");

  if (!authenticated && !publicEntry) {
    try {
      sessionStorage.setItem("redirectAfterAuth", to.fullPath);
    } catch (error) {
      console.warn("[Auth] Could not preserve the requested route:", error);
    }
    return navigateTo("/auth", { replace: true });
  }
});
