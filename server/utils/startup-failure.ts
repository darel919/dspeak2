export async function terminateFailedStartup(
  error,
  {
    closeRuntime = async () => {},
    exit = process.exit,
    stopBackground = () => {},
  } = {} as any,
) {
  stopBackground();
  await closeRuntime().catch((closeError) =>
    console.error(
      "[Server] failed to clean up after startup failure",
      closeError,
    ),
  );
  console.error("[Server] startup failed", error);
  exit(1);
  throw error;
}
