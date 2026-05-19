// ===========================================
// Audio Publisher
// Publishes PCM audio frames as a microphone track
// in the LiveKit room via @livekit/rtc-node
//
// Verified API from livekit/node-sdks examples:
//   - AudioSource(sampleRate, channels)
//   - LocalAudioTrack.createAudioTrack(name, source)
//   - source.captureFrame(new AudioFrame(int16, rate, channels, samplesPerChannel))
// ===========================================

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import logger from "../../utils/logger.js";

const SAMPLE_RATE = 16000;
const CHANNELS = 1;

export class AudioPublisher {
  /**
   * @param {Object} room  LiveKit Room from the agent context
   */
  constructor(room) {
    this.room = room;
    this.source = null;
    this.track = null;
    this.published = false;
    this.totalSamplesPushed = 0;
  }

  // --- Create + publish the audio track to the room ---

  async start() {
    if (this.published) return;

    this.source = new AudioSource(SAMPLE_RATE, CHANNELS);
    this.track = LocalAudioTrack.createAudioTrack("voice-tutor", this.source);

    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;

    await this.room.localParticipant.publishTrack(this.track, options);
    this.published = true;

    logger.info(`[AudioPublisher] Published audio track (${SAMPLE_RATE}Hz, ${CHANNELS}ch)`);
  }

  // --- Push a chunk of PCM audio (raw Int16 little-endian buffer) ---
  // Returns the duration (ms) added by this push.

  async pushPCM(pcmBuffer) {
    if (!this.source) {
      throw new Error("AudioPublisher not started — call start() first");
    }
    if (!pcmBuffer || pcmBuffer.length === 0) return 0;

    // Convert Node Buffer → Int16Array (PCM 16-bit little-endian samples)
    const int16 = new Int16Array(
      pcmBuffer.buffer,
      pcmBuffer.byteOffset,
      pcmBuffer.length / 2
    );

    const samplesPerChannel = int16.length / CHANNELS;
    const frame = new AudioFrame(int16, SAMPLE_RATE, CHANNELS, samplesPerChannel);

    await this.source.captureFrame(frame);

    this.totalSamplesPushed += samplesPerChannel;
    return (samplesPerChannel / SAMPLE_RATE) * 1000;
  }

  // --- Cumulative audio duration emitted so far (ms) ---

  getCurrentTimeMs() {
    return (this.totalSamplesPushed / SAMPLE_RATE) * 1000;
  }

  // --- Drop any audio still buffered in the native source ---
  // Used on pause/Q&A so leftover lecture audio stops instantly
  // instead of bleeding over the Q&A reply.

  clearQueue() {
    try {
      this.source?.clearQueue();
    } catch (err) {
      logger.warn("[AudioPublisher] clearQueue warning:", err.message);
    }
  }

  // Approx audio still queued (ms) in the native source.
  queuedDurationMs() {
    return this.source ? this.source.queuedDuration : 0;
  }

  // --- Stop and clean up ---

  async stop() {
    try {
      if (this.track) {
        await this.track.close();
      }
    } catch (err) {
      logger.warn("[AudioPublisher] Track close warning:", err.message);
    }
    this.published = false;
  }
}

export default AudioPublisher;
