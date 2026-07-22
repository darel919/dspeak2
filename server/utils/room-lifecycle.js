export async function acquireSharedRoom({ rooms, creations, key, create }) {
  let room = rooms.get(key);
  if (!room) {
    let pending = creations.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(create)
        .then((created) => {
          rooms.set(key, created);
          return created;
        })
        .finally(() => creations.delete(key));
      creations.set(key, pending);
    }
    room = await pending;
  }
  room.pendingJoins = (Number(room.pendingJoins) || 0) + 1;
  return room;
}

export function releaseRoomReservation(room) {
  room.pendingJoins = Math.max(0, (Number(room.pendingJoins) || 0) - 1);
}

export function isRoomUnused(room) {
  return room.sessions.size === 0 && (Number(room.pendingJoins) || 0) === 0;
}
