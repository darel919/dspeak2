let participantDisconnectedHandler = null;

export function registerDjParticipantDisconnectedHandler(handler) {
  participantDisconnectedHandler = handler;
}

export function notifyDjParticipantDisconnected(channelId, userId) {
  participantDisconnectedHandler?.(String(channelId), String(userId));
}
