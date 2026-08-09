import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldCloseSocketOnPageHide } from "../app/shared/socket-lifecycle.js";

describe("socket pagehide lifecycle", () => {
  it("closes sockets that are open", () => {
    assert.equal(shouldCloseSocketOnPageHide(WebSocket.OPEN), true);
  });

  it("closes sockets that are still connecting", () => {
    assert.equal(shouldCloseSocketOnPageHide(WebSocket.CONNECTING), true);
  });

  it("leaves closing and closed sockets alone", () => {
    assert.equal(shouldCloseSocketOnPageHide(WebSocket.CLOSING), false);
    assert.equal(shouldCloseSocketOnPageHide(WebSocket.CLOSED), false);
  });

  it("ignores unknown ready states", () => {
    assert.equal(shouldCloseSocketOnPageHide(undefined), false);
    assert.equal(shouldCloseSocketOnPageHide(null), false);
    assert.equal(shouldCloseSocketOnPageHide(999), false);
  });
});
