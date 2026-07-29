export function collectSfuMetrics(state) {
  let transports = 0;
  let producers = 0;
  let consumers = 0;
  const topologies = {
    p2p: 0,
    sfu: 0,
    probing: 0,
    switching: 0,
    idle: 0,
  };
  for (const room of state.rooms.values()) {
    if (Object.hasOwn(topologies, room.topology.mode))
      topologies[room.topology.mode] += 1;
    for (const broadcast of room.broadcasts?.values() || []) {
      transports += Number(Boolean(broadcast.transport));
      producers += Number(Boolean(broadcast.producer));
    }
  }
  for (const session of state.sessions.values()) {
    transports += session.transports.size;
    producers += session.producers.size;
    consumers += session.consumers.size;
  }
  return {
    workerPid: state.worker?.pid || 0,
    rooms: state.rooms.size,
    peers: state.sessions.size,
    transports,
    producers,
    consumers,
    p2pRooms: topologies.p2p,
    sfuRooms: topologies.sfu,
    probingRooms: topologies.probing,
    switchingRooms: topologies.switching,
    idleRooms: topologies.idle,
  };
}
