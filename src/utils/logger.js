// ===========================================
// Logger Utility
// Simple structured logger with timestamps
// ===========================================

/**
 * Get current timestamp in ISO format
 */
function timestamp() {
  return new Date().toISOString();
}

// --- Log Level Functions ---

export function info(...args) {
  console.log(`[${timestamp()}] [INFO]`, ...args);
}

export function error(...args) {
  console.error(`[${timestamp()}] [ERROR]`, ...args);
}

export function warn(...args) {
  console.warn(`[${timestamp()}] [WARN]`, ...args);
}

export function debug(...args) {
  if (process.env.DEBUG === "true") {
    console.log(`[${timestamp()}] [DEBUG]`, ...args);
  }
}

// --- Default Export ---

export default { info, error, warn, debug };
