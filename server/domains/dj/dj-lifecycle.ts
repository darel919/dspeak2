type ParticipantDisconnectedHandler = (
  channelId: string,
  userId: string,
) => void;

let participantDisconnectedHandler: ParticipantDisconnectedHandler | null =
  null;

export function registerDjParticipantDisconnectedHandler(
  handler: ParticipantDisconnectedHandler,
): void {
  participantDisconnectedHandler = handler;
}

export function notifyDjParticipantDisconnected(
  channelId: string,
  userId: string,
): void {
  participantDisconnectedHandler?.(String(channelId), String(userId));
}
