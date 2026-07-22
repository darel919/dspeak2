import { probeSelfHostedTurn } from "../utils/turn-health";

export default defineEventHandler(async () => ({
  status: "ok",
  service: "dspeak",
  timestamp: new Date().toISOString(),
  turn: {
    selfHosted: await probeSelfHostedTurn(),
    communityFallbacks: true,
  },
}));
