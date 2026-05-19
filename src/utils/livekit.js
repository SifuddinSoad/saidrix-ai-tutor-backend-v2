// ===========================================
// LiveKit Utilities
// Access token generation for room access
// UNVERIFIED: AccessToken API verified against livekit-server-sdk v2.x README
// ===========================================

import { AccessToken } from "livekit-server-sdk";

/**
 * Generate a LiveKit access token for a participant to join a room.
 *
 * @param {Object} opts
 * @param {string} opts.roomName       Room identifier (created on join if not exists)
 * @param {string} opts.identity       Unique participant identifier
 * @param {string} [opts.name]         Display name
 * @param {object} [opts.metadata]     Arbitrary JSON metadata visible to other participants
 * @param {boolean} [opts.canPublish=false]  Whether participant can publish tracks
 * @param {boolean} [opts.canSubscribe=true] Whether participant can subscribe to tracks
 * @param {string} [opts.ttl="6h"]     Token lifetime
 *
 * @returns {Promise<string>} Signed JWT
 */
export async function generateAccessToken({
  roomName,
  identity,
  name = undefined,
  metadata = undefined,
  canPublish = true,    // Phase 2: students publish mic by default
  canSubscribe = true,
  ttl = "6h",
}) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    throw new Error("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set in .env");
  }

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity,
      name,
      // Metadata is a string in LiveKit — JSON.stringify if object passed
      metadata:
        metadata && typeof metadata === "object"
          ? JSON.stringify(metadata)
          : metadata,
      ttl,
    }
  );

  // Add room access grant
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe,
    canPublishData: true, // allow client to send data messages (e.g., pause/skip later)
  });

  // toJwt() is async in v2 of the SDK
  return await at.toJwt();
}

export default { generateAccessToken };
