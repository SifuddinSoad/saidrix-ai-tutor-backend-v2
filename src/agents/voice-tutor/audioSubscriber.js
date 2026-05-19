// ===========================================
// Audio Subscriber
// Subscribes to student's audio track in the LiveKit room,
// routes audio frames into Silero VAD + Deepgram STT, and
// surfaces speech-start / speech-end / final-transcript events.
//
// Uses @livekit/rtc-node directly:
//   - AudioStream(track) — async iterator of AudioFrames
//   - TrackKind.KIND_AUDIO = 1 (numeric enum)
// ===========================================

import { AudioStream, TrackKind } from "@livekit/rtc-node";
import logger from "../../utils/logger.js";

// TrackKind.KIND_AUDIO is 1 in the rtc-node enum. Use both numeric and
// enum-based comparison so this works even if the enum is missing.
const AUDIO_KIND = TrackKind?.KIND_AUDIO ?? 1;

export class AudioSubscriber {
  constructor({ room, vad, stt, callbacks, shouldIgnoreFrames = () => false }) {
    this.room = room;
    this.vad = vad;
    this.stt = stt;
    this.callbacks = callbacks;
    this.shouldIgnoreFrames = shouldIgnoreFrames;
    this.started = false;
    this.teardown = [];

    this._frameCount = 0;
    this._vadEventCount = 0;
    this._sttFinalCount = 0;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    // --- Plugin readiness checks ---
    if (!this.vad || typeof this.vad.stream !== "function") {
      logger.error(
        `[AudioSubscriber] VAD invalid (vad=${!!this.vad}, hasStream=${
          this.vad && typeof this.vad.stream === "function"
        })`
      );
      return;
    }
    if (!this.stt || typeof this.stt.stream !== "function") {
      logger.error(
        `[AudioSubscriber] STT invalid (stt=${!!this.stt}, hasStream=${
          this.stt && typeof this.stt.stream === "function"
        })`
      );
      return;
    }
    if (typeof AudioStream !== "function") {
      logger.error(
        "[AudioSubscriber] @livekit/rtc-node AudioStream not available"
      );
      return;
    }

    logger.info(
      `[AudioSubscriber] Ready (AUDIO_KIND=${AUDIO_KIND}); awaiting tracks...`
    );

    const onTrackSubscribed = async (track, publication, participant) => {
      const identity = participant?.identity || "unknown";
      const kind = track?.kind;

      logger.info(
        `[AudioSubscriber] trackSubscribed: identity=${identity}, kind=${kind} (audio=${AUDIO_KIND})`
      );

      // Compare numerically to TrackKind.KIND_AUDIO (==1)
      if (Number(kind) !== AUDIO_KIND) {
        logger.info(`[AudioSubscriber] Skipping kind=${kind} (not audio)`);
        return;
      }
      if (!identity.startsWith("student")) {
        logger.info(
          `[AudioSubscriber] Skipping non-student identity: ${identity}`
        );
        return;
      }

      try {
        await this._attachToTrack(track, identity);
      } catch (err) {
        logger.error(`[AudioSubscriber] _attachToTrack failed: ${err.message}`);
      }
    };

    // Attach handler for both camelCase + snake_case event names
    for (const evt of ["trackSubscribed", "track_subscribed"]) {
      try {
        this.room.on(evt, onTrackSubscribed);
        this.teardown.push(() => {
          try { this.room.off?.(evt, onTrackSubscribed); } catch {}
        });
      } catch {}
    }

    // Walk already-subscribed tracks (catch tracks that arrived before us)
    try {
      const participants = this.room.remoteParticipants || this.room.participants;
      participants?.forEach?.((participant) => {
        const pubs = participant.trackPublications || participant.tracks || new Map();
        pubs?.forEach?.((pub) => {
          if (pub.track) {
            onTrackSubscribed(pub.track, pub, participant);
          }
        });
      });
    } catch (err) {
      logger.warn(`[AudioSubscriber] Walking participants failed: ${err.message}`);
    }
  }

  // ===========================================
  // Attach to a single audio track
  // ===========================================

  async _attachToTrack(track, identity) {
    logger.info(`[AudioSubscriber] Attaching pipeline for ${identity}`);

    const vadStream = this.vad.stream();
    const sttStream = this.stt.stream();
    const audioStream = new AudioStream(track);

    if (!vadStream || !sttStream || !audioStream) {
      logger.error(
        `[AudioSubscriber] Stream init failed (vad=${!!vadStream} stt=${!!sttStream} audio=${!!audioStream})`
      );
      return;
    }

    // --- 1. Pump audio frames from rtc-node AudioStream into VAD + STT ---
    (async () => {
      try {
        for await (const frame of audioStream) {
          if (this.shouldIgnoreFrames()) continue;

          this._frameCount++;
          if (this._frameCount === 1) {
            logger.info(
              `[AudioSubscriber] First audio frame received (samplesPerChannel=${frame?.samplesPerChannel || "?"}, sampleRate=${frame?.sampleRate || "?"})`
            );
          }
          if (this._frameCount % 500 === 0) {
            logger.info(
              `[AudioSubscriber] frames=${this._frameCount} vadEvents=${this._vadEventCount} sttFinals=${this._sttFinalCount}`
            );
          }

          // VAD + STT plugins exposes pushFrame(frame). Some versions use
          // an async iterator producer model — try pushFrame first, fall
          // back to write/send for compat.
          try {
            if (typeof vadStream.pushFrame === "function") {
              vadStream.pushFrame(frame);
            } else if (typeof vadStream.write === "function") {
              vadStream.write(frame);
            } else if (this._frameCount === 1) {
              logger.error(
                `[AudioSubscriber] vadStream has no pushFrame/write method (keys: ${Object.keys(vadStream).join(",")})`
              );
            }
          } catch (err) {
            if (this._frameCount === 1)
              logger.error(`[AudioSubscriber] vad.pushFrame failed: ${err.message}`);
          }

          try {
            if (typeof sttStream.pushFrame === "function") {
              sttStream.pushFrame(frame);
            } else if (typeof sttStream.write === "function") {
              sttStream.write(frame);
            } else if (this._frameCount === 1) {
              logger.error(
                `[AudioSubscriber] sttStream has no pushFrame/write method (keys: ${Object.keys(sttStream).join(",")})`
              );
            }
          } catch (err) {
            if (this._frameCount === 1)
              logger.error(`[AudioSubscriber] stt.pushFrame failed: ${err.message}`);
          }
        }
      } catch (err) {
        logger.error(`[AudioSubscriber] Audio stream loop crashed: ${err.message}`);
      }
    })();

    // --- 2. VAD events → speech-start / speech-end ---
    // Silero plugin emits NUMERIC event types:
    //   0 = START_OF_SPEECH
    //   1 = INFERENCE_DONE (continuous, ignore — fires every ~30ms)
    //   2 = END_OF_SPEECH
    (async () => {
      try {
        for await (const ev of vadStream) {
          this._vadEventCount++;
          const type = ev?.type;

          // Ignore continuous INFERENCE_DONE — too noisy
          if (type === 1 || type === "inference_done") continue;

          // Log only meaningful events (start/end of speech)
          logger.info(
            `[AudioSubscriber] VAD ${type === 0 ? "START_OF_SPEECH" : type === 2 ? "END_OF_SPEECH" : type}`
          );

          if (
            type === 0 ||
            type === "start_of_speech" ||
            type === "speech_start"
          ) {
            await this.callbacks.onSpeechStart?.();
          } else if (
            type === 2 ||
            type === "end_of_speech" ||
            type === "speech_end"
          ) {
            await this.callbacks.onSpeechEnd?.();
          }
        }
      } catch (err) {
        logger.error(`[AudioSubscriber] VAD stream loop crashed: ${err.message}`);
      }
    })();

    // --- 3. STT events → final transcript ---
    // Deepgram plugin emits NUMERIC SpeechEventType:
    //   0 = START_OF_SPEECH
    //   1 = INTERIM_TRANSCRIPT
    //   2 = FINAL_TRANSCRIPT      ← what we want
    //   3 = END_OF_SPEECH
    //   4 = RECOGNITION_USAGE (billing event, ignore)
    (async () => {
      try {
        for await (const ev of sttStream) {
          const type = ev?.type;
          const text = ev?.alternatives?.[0]?.text ?? ev?.text;
          const isFinal =
            type === 2 ||
            ev?.isFinal === true ||
            ev?.is_final === true ||
            type === "final_transcript";

          if (text) {
            logger.info(
              `[AudioSubscriber] STT ${isFinal ? "FINAL" : "interim"} (type=${type}): "${text}"`
            );
          }

          if (text && isFinal) {
            this._sttFinalCount++;
            await this.callbacks.onTranscript?.(text);
          }
        }
      } catch (err) {
        logger.error(`[AudioSubscriber] STT stream loop crashed: ${err.message}`);
      }
    })();

    this.teardown.push(() => {
      try { vadStream.close?.(); } catch {}
      try { sttStream.close?.(); } catch {}
      try { audioStream.close?.(); } catch {}
    });

    logger.info(`[AudioSubscriber] Pipeline ready for ${identity}`);
  }

  async stop() {
    for (const fn of this.teardown.reverse()) {
      try { await fn(); } catch {}
    }
    this.teardown = [];
    this.started = false;
  }
}

export default AudioSubscriber;
