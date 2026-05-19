// ===========================================
// Tests: livekit token generation
// Verifies token is signed and decodable
// ===========================================

import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAccessToken } from "../../src/utils/livekit.js";

// --- Helper: decode JWT payload without verifying signature ---

function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  assert.equal(parts.length, 3, "JWT must have 3 parts");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
  return payload;
}

// --- Basic generation ---

test("generates a JWT with correct identity and room grant", async () => {
  const jwt = await generateAccessToken({
    roomName: "test-room-123",
    identity: "alice",
  });

  assert.equal(typeof jwt, "string");
  assert.ok(jwt.split(".").length === 3);

  const payload = decodeJwtPayload(jwt);
  assert.equal(payload.sub, "alice");
  assert.equal(payload.video?.room, "test-room-123");
  assert.equal(payload.video?.roomJoin, true);
});

// --- Different rooms produce different tokens ---

test("different rooms produce different tokens", async () => {
  const t1 = await generateAccessToken({ roomName: "room-A", identity: "u" });
  const t2 = await generateAccessToken({ roomName: "room-B", identity: "u" });
  assert.notEqual(t1, t2);
});

// --- Metadata is preserved (as string) ---

test("metadata object is serialized into token", async () => {
  const jwt = await generateAccessToken({
    roomName: "r",
    identity: "u",
    metadata: { foo: "bar", sessionId: "abc-123" },
  });
  const payload = decodeJwtPayload(jwt);
  const meta = JSON.parse(payload.metadata);
  assert.equal(meta.foo, "bar");
  assert.equal(meta.sessionId, "abc-123");
});
