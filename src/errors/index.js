// ===========================================
// Barrel — single import surface for error handling
//   import { asyncHandler, NotFoundError } from "../errors/index.js";
// ===========================================

export {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  PaymentRequiredError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UpstreamError,
  ServiceUnavailableError,
  TimeoutError,
} from "./AppError.js";

export { asyncHandler } from "./asyncHandler.js";
export { notFoundHandler, errorHandler } from "./errorMiddleware.js";
export { registerProcessHandlers } from "./processHandlers.js";
