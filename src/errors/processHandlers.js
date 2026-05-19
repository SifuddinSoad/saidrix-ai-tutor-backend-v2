// ===========================================
// Process-level safety net + graceful shutdown
//   - unhandledRejection / uncaughtException: log,
//     then exit so the orchestrator restarts a clean
//     process (a corrupt event loop must not linger).
//   - SIGTERM / SIGINT: stop accepting connections,
//     close the HTTP server, then exit.
// ===========================================

import logger from "../utils/logger.js";

let shuttingDown = false;

/**
 * @param {import('http').Server} [server]  HTTP server to close on signals
 * @param {object} [opts]
 * @param {() => Promise<void>} [opts.onShutdown]  extra async cleanup (DB, timers)
 */
export function registerProcessHandlers(server, { onShutdown } = {}) {
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.stack || reason.message : reason;
    logger.error("UNHANDLED REJECTION —", msg);
    shutdown("unhandledRejection", server, onShutdown, 1);
  });

  process.on("uncaughtException", (err) => {
    logger.error("UNCAUGHT EXCEPTION —", err?.stack || err?.message || err);
    shutdown("uncaughtException", server, onShutdown, 1);
  });

  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.on(sig, () => {
      logger.info(`Received ${sig} — shutting down gracefully`);
      shutdown(sig, server, onShutdown, 0);
    });
  }
}

function shutdown(reason, server, onShutdown, code) {
  if (shuttingDown) return;
  shuttingDown = true;

  // Hard safety: never hang forever waiting on close()
  const killTimer = setTimeout(() => {
    logger.error(`Forced exit after stalled shutdown (${reason})`);
    process.exit(code || 1);
  }, 10000);
  killTimer.unref?.();

  const done = async () => {
    try {
      if (onShutdown) await onShutdown();
    } catch (e) {
      logger.error("Shutdown cleanup failed:", e?.message || e);
    }
    clearTimeout(killTimer);
    process.exit(code);
  };

  if (server && typeof server.close === "function") {
    server.close(() => done());
  } else {
    done();
  }
}

export default registerProcessHandlers;
