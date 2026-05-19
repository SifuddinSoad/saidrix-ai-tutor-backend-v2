// ===========================================
// Central Express error handling
//   notFoundHandler  - mount AFTER all routes (404)
//   errorHandler     - mount LAST (4-arg signature)
//
// Normalizes Mongoose, JSON-parse, and unknown errors
// into a consistent JSON envelope:
//   { error: string, code: string, details?: any }
// Non-operational errors are logged with full stack
// and the message is generalized in production.
// ===========================================

import logger from "../utils/logger.js";
import { AppError, NotFoundError } from "./AppError.js";

const IS_PROD = process.env.NODE_ENV === "production";

// --- 404 for unmatched routes ---
export function notFoundHandler(req, res, next) {
  next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
}

// --- Translate well-known non-AppError errors into AppError ---
function normalize(err) {
  if (err instanceof AppError) return err;

  // express.json() body parse failure
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return new AppError("Invalid JSON in request body", 400, {
      code: "BAD_JSON",
      cause: err,
    });
  }

  // Mongoose validation
  if (err?.name === "ValidationError" && err?.errors) {
    const details = Object.fromEntries(
      Object.entries(err.errors).map(([k, v]) => [k, v.message])
    );
    return new AppError("Validation failed", 400, {
      code: "VALIDATION",
      details,
      cause: err,
    });
  }

  // Mongoose bad ObjectId / cast
  if (err?.name === "CastError") {
    return new AppError(`Invalid value for "${err.path}"`, 400, {
      code: "CAST",
      cause: err,
    });
  }

  // Mongo duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return new AppError(`Duplicate value for "${field}"`, 409, {
      code: "DUPLICATE",
      cause: err,
    });
  }

  // Unknown / programmer error → 500, non-operational
  const wrapped = new AppError(err?.message || "Internal server error", 500, {
    code: "INTERNAL",
    cause: err,
  });
  wrapped.isOperational = false;
  return wrapped;
}

// --- Central handler (must keep 4 args for Express) ---
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const e = normalize(err);

  const logLine = `${req.method} ${req.originalUrl} -> ${e.statusCode} ${e.code}: ${e.message}`;
  if (e.statusCode >= 500 || !e.isOperational) {
    logger.error(logLine, e.cause?.stack || e.stack || "");
  } else {
    logger.warn(logLine);
  }

  // If headers already sent, delegate to Express' default closer
  if (res.headersSent) return next(err);

  const body = {
    error:
      !e.isOperational && IS_PROD
        ? "Internal server error"
        : e.message,
    code: e.code,
  };
  if (e.details !== undefined) body.details = e.details;
  if (!IS_PROD && (e.statusCode >= 500 || !e.isOperational)) {
    body.stack = (e.cause?.stack || e.stack || "").split("\n").slice(0, 6);
  }

  res.status(e.statusCode || 500).json(body);
}

export default { notFoundHandler, errorHandler };
