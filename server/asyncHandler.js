// Express 4 doesn't catch rejected promises thrown by async route handlers
// automatically — an unhandled rejection there just leaves the request
// hanging with no response. Wrap any async (req, res) handler with this so
// errors reach Express's error-handling middleware via next(err) instead.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
