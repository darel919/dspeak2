import type { ExternalError } from "../../shared/types/external.ts";

export async function terminateFailedStartup(
  error: ExternalError,
  {
    closeRuntime = async () => {},
    exit = process.exit,
    stopBackground = () => {},
  }: {
    closeRuntime?: () => Promise<void>;
    exit?: (code: number) => never;
    stopBackground?: () => void;
  } = {},
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
