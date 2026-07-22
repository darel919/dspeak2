import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireSharedRoom,
  isRoomUnused,
  releaseRoomReservation,
} from "../server/utils/room-lifecycle.js";

test("concurrent first joins share one room creation and reserve it from disposal", async () => {
  const rooms = new Map();
  const creations = new Map();
  let createCount = 0;
  let finishCreation;
  const creationGate = new Promise((resolve) => {
    finishCreation = resolve;
  });
  const create = async () => {
    createCount += 1;
    await creationGate;
    return { sessions: new Map(), pendingJoins: 0 };
  };

  const first = acquireSharedRoom({ rooms, creations, key: "room-1", create });
  const second = acquireSharedRoom({ rooms, creations, key: "room-1", create });
  await Promise.resolve();
  assert.equal(createCount, 1);
  finishCreation();

  const [firstRoom, secondRoom] = await Promise.all([first, second]);
  assert.equal(firstRoom, secondRoom);
  assert.equal(firstRoom.pendingJoins, 2);
  assert.equal(isRoomUnused(firstRoom), false);

  releaseRoomReservation(firstRoom);
  releaseRoomReservation(secondRoom);
  assert.equal(isRoomUnused(firstRoom), true);
});

test("a failed room creation is removed so a later join can retry", async () => {
  const rooms = new Map();
  const creations = new Map();
  await assert.rejects(
    acquireSharedRoom({
      rooms,
      creations,
      key: "room-1",
      create: () => Promise.reject(new Error("router failed")),
    }),
    /router failed/,
  );
  assert.equal(creations.size, 0);

  const room = await acquireSharedRoom({
    rooms,
    creations,
    key: "room-1",
    create: async () => ({ sessions: new Map(), pendingJoins: 0 }),
  });
  assert.equal(room.pendingJoins, 1);
});
