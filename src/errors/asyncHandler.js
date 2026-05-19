// ===========================================
// asyncHandler — wrap async route handlers so any
// thrown error / rejected promise is forwarded to
// the central Express error middleware instead of
// crashing the process or hanging the request.
//
// Usage:
//   router.get("/x", asyncHandler(async (req, res) => { ... }))
// ===========================================

export function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
