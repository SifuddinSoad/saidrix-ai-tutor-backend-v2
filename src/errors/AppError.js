// ===========================================
// AppError — typed, operational error hierarchy
// `isOperational` distinguishes expected, handled
// failures (bad input, missing doc) from programmer
// bugs. The central error middleware uses statusCode
// + code to shape the HTTP response.
// ===========================================

export class AppError extends Error {
  /**
   * @param {string} message  Human-readable message (safe to expose)
   * @param {number} statusCode  HTTP status
   * @param {object} [opts]
   * @param {string} [opts.code]      Stable machine code (e.g. NOT_FOUND)
   * @param {*}      [opts.details]   Extra structured info for the client
   * @param {Error}  [opts.cause]     Underlying error (kept for logs only)
   */
  constructor(message, statusCode = 500, { code, details, cause } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code || this.constructor.name.replace(/Error$/, "").toUpperCase() || "ERROR";
    this.details = details;
    this.isOperational = true;
    if (cause) this.cause = cause;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// --- 400 ---
export class BadRequestError extends AppError {
  constructor(message = "Bad request", opts = {}) {
    super(message, 400, { code: "BAD_REQUEST", ...opts });
  }
}

// --- 400 / validation ---
export class ValidationError extends AppError {
  constructor(message = "Validation failed", opts = {}) {
    super(message, 400, { code: "VALIDATION", ...opts });
  }
}

// --- 402 — payment required (trial expired / inactive subscription) ---
export class PaymentRequiredError extends AppError {
  constructor(message = "Payment required", opts = {}) {
    super(message, 402, { code: "PAYMENT_REQUIRED", ...opts });
  }
}

// --- 401 ---
export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized", opts = {}) {
    super(message, 401, { code: "UNAUTHORIZED", ...opts });
  }
}

// --- 403 ---
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", opts = {}) {
    super(message, 403, { code: "FORBIDDEN", ...opts });
  }
}

// --- 404 ---
export class NotFoundError extends AppError {
  constructor(message = "Resource not found", opts = {}) {
    super(message, 404, { code: "NOT_FOUND", ...opts });
  }
}

// --- 409 ---
export class ConflictError extends AppError {
  constructor(message = "Conflict", opts = {}) {
    super(message, 409, { code: "CONFLICT", ...opts });
  }
}

// --- 502 — failure talking to an upstream provider (LLM, TTS, etc.) ---
export class UpstreamError extends AppError {
  constructor(message = "Upstream service failed", opts = {}) {
    super(message, 502, { code: "UPSTREAM", ...opts });
  }
}

// --- 503 ---
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service unavailable", opts = {}) {
    super(message, 503, { code: "SERVICE_UNAVAILABLE", ...opts });
  }
}

// --- 504 ---
export class TimeoutError extends AppError {
  constructor(message = "Operation timed out", opts = {}) {
    super(message, 504, { code: "TIMEOUT", ...opts });
  }
}

export default AppError;
