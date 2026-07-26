export function navigationErrorStatus(cause) {
  return Number(
    cause?.statusCode ||
      cause?.status ||
      cause?.response?.status ||
      cause?.data?.statusCode ||
      0,
  );
}

export function isNavigationAccessError(cause) {
  const statusCode = navigationErrorStatus(cause);
  return statusCode === 403 || statusCode === 404;
}

export function useNavigationError() {
  function presentNavigationError(cause, message) {
    const statusCode = navigationErrorStatus(cause);
    if (!isNavigationAccessError(cause)) return false;
    showError({
      statusCode,
      statusMessage: "Invalid link",
      message:
        message ||
        "This link is invalid, or your account does not have permission to open it.",
      fatal: true,
    });
    return true;
  }

  return { presentNavigationError };
}
