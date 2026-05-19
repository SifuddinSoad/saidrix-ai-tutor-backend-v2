// ===========================================
// Player Control
// Shared state machine + event bus for lecture playback control.
// Used by LecturePlayer (consumer) and control sources (VAD,
// data channel commands, REST endpoints) — producers.
// ===========================================

import { EventEmitter } from "node:events";

// State values
export const STATE = {
  PLAYING: "playing",
  PAUSED: "paused",
  IN_QA: "in_qa",
  COMPLETED: "completed",
};

export class PlayerControl extends EventEmitter {
  constructor() {
    super();

    // --- Playback state ---
    this.state = STATE.PLAYING;
    this.pauseReason = null;

    // --- Segment tracking ---
    this.currentSegmentIdx = 0;
    // Sparse Lecture.blocks index of the segment currently playing
    // (title=-2, summary=-1). Used for catch-up re-emit to late joiners.
    this.currentBlockIndex = null;

    // --- Segment-level flags (consumed by player at segment boundaries) ---
    this.shouldSkip = false;       // skip current segment, advance
    this.shouldRepeat = false;     // restart current segment
    this.jumpToSegment = null;     // jump to a specific segment index

    // --- Abort flag (used to break out of in-progress segment chunk loop) ---
    this.shouldAbortSegment = false;

    // Internal: resolvers waiting on a state-change
    this._resumeResolvers = [];
  }

  // ===========================================
  // State Transitions
  // ===========================================

  // --- Pause playback (from user button OR student speech start) ---
  pause(reason = "user") {
    if (this.state === STATE.COMPLETED) return;
    this.state = STATE.PAUSED;
    this.pauseReason = reason;
    this.emit("pause", reason);
  }

  // --- Resume playback ---
  resume() {
    if (this.state === STATE.COMPLETED) return;
    this.state = STATE.PLAYING;
    this.pauseReason = null;
    this.emit("resume");
    this._releaseWaiters();
  }

  // --- Enter Q&A mode (lecture paused while AI answers) ---
  enterQA() {
    if (this.state === STATE.COMPLETED) return;
    this.state = STATE.IN_QA;
    this.emit("qa_start");
  }

  // --- Exit Q&A back to playing ---
  exitQA() {
    if (this.state === STATE.COMPLETED) return;
    this.state = STATE.PLAYING;
    this.emit("qa_end");
    this._releaseWaiters();
  }

  // --- Mark playback completed (terminal) ---
  complete() {
    this.state = STATE.COMPLETED;
    this.emit("completed");
    this._releaseWaiters();
  }

  // ===========================================
  // Control Requests (consumed by player)
  // ===========================================

  requestSkip() {
    this.shouldSkip = true;
    this.shouldAbortSegment = true;
    this.emit("skip");
  }

  requestRepeat() {
    this.shouldRepeat = true;
    this.shouldAbortSegment = true;
    this.emit("repeat");
  }

  requestJump(segmentIdx) {
    if (typeof segmentIdx !== "number" || segmentIdx < 0) return;
    this.jumpToSegment = segmentIdx;
    this.shouldAbortSegment = true;
    this.emit("jump", segmentIdx);
  }

  // --- Reset flags after the player has consumed them ---
  clearSegmentFlags() {
    this.shouldSkip = false;
    this.shouldRepeat = false;
    this.jumpToSegment = null;
    this.shouldAbortSegment = false;
  }

  // ===========================================
  // Segment Tracking
  // ===========================================

  setSegmentIdx(idx) {
    if (idx !== this.currentSegmentIdx) {
      this.currentSegmentIdx = idx;
      this.emit("segmentChange", idx);
    }
  }

  // ===========================================
  // Consumer API (used by LecturePlayer)
  // ===========================================

  // Returns true if the player should stop yielding TTS chunks
  // for the current segment.
  isAborting() {
    return this.shouldAbortSegment || this.state === STATE.COMPLETED;
  }

  // Returns true if playback is actively going
  isPlaying() {
    return this.state === STATE.PLAYING;
  }

  // Block until state becomes PLAYING (or COMPLETED).
  // Used between TTS chunks so pause/Q&A holds the player.
  async waitIfPaused() {
    if (this.state === STATE.PLAYING || this.state === STATE.COMPLETED) {
      return;
    }
    await new Promise((resolve) => {
      this._resumeResolvers.push(resolve);
    });
  }

  _releaseWaiters() {
    const resolvers = this._resumeResolvers;
    this._resumeResolvers = [];
    for (const r of resolvers) r();
  }
}

export default PlayerControl;
