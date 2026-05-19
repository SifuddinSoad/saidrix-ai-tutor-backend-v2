// ===========================================
// Control Command Handler
// Listens to LiveKit data channel for frontend control commands
// (pause, resume, skip, repeat, jump) and routes them to PlayerControl.
// ===========================================

import logger from "../../utils/logger.js";

const decoder = new TextDecoder();

/**
 * Parse a single incoming data-channel payload into a command spec.
 * Pure function — extracted for testability.
 *
 * @param {Uint8Array|Buffer} payload  Raw bytes from data channel
 * @returns {Object|null}  { command, blockIndex? } or null if invalid
 */
export function parseCommand(payload) {
  try {
    const text = decoder.decode(payload);
    const msg = JSON.parse(text);
    if (!msg || typeof msg.command !== "string") return null;

    const validCommands = ["pause", "resume", "skip", "repeat", "jump"];
    if (!validCommands.includes(msg.command)) return null;

    const out = { command: msg.command };
    if (msg.command === "jump" && typeof msg.blockIndex === "number") {
      out.blockIndex = msg.blockIndex;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Apply a parsed command to a PlayerControl instance.
 * Pure function — extracted for testability.
 *
 * @param {Object} cmd        { command, blockIndex? }
 * @param {PlayerControl} pc  Target control instance
 */
export function applyCommand(cmd, pc) {
  if (!cmd || !pc) return;
  switch (cmd.command) {
    case "pause":
      pc.pause("user");
      break;
    case "resume":
      pc.resume();
      break;
    case "skip":
      pc.requestSkip();
      break;
    case "repeat":
      pc.requestRepeat();
      break;
    case "jump":
      if (typeof cmd.blockIndex === "number") {
        pc.requestJump(cmd.blockIndex);
      }
      break;
  }
}

/**
 * Attach the control listener to a LiveKit Room.
 * UNVERIFIED: room.on("dataReceived", ...) verified against rtc-node README.
 * The signature is (payload, participant, kind, topic).
 *
 * @param {Object} room              LiveKit Room
 * @param {PlayerControl} pc         Player control instance to drive
 * @param {Object} [opts]
 * @param {string} [opts.topic]      If set, only handle messages on this topic
 */
export function setupControlHandler(room, pc, opts = {}) {
  if (!room || !pc) return;

  const topicFilter = opts.topic || null;

  // UNVERIFIED: rtc-node event names; common alternatives are "dataReceived"
  // and "data_received". Subscribe to both to be safe.
  const handler = (payload, participant, _kind, topic) => {
    // Optional topic filter
    if (topicFilter && topic && topic !== topicFilter) return;

    const cmd = parseCommand(payload);
    if (!cmd) return;

    logger.info(
      `[ControlHandler] Command: ${cmd.command}${cmd.blockIndex !== undefined ? ` (block ${cmd.blockIndex})` : ""}`
    );
    applyCommand(cmd, pc);
  };

  try {
    room.on("dataReceived", handler);
  } catch {}
  try {
    room.on("data_received", handler);
  } catch {}

  // Return a teardown function
  return () => {
    try {
      room.off?.("dataReceived", handler);
    } catch {}
    try {
      room.off?.("data_received", handler);
    } catch {}
  };
}

export default { parseCommand, applyCommand, setupControlHandler };
