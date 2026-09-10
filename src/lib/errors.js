export class ApiError extends Error {
  constructor(status, message, fields) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

export const badRequest = (message, fields) => new ApiError(400, message, fields)
export const unauthorized = (message = 'Please sign in to continue.') => new ApiError(401, message)
export const notFound = (message = 'Not found.') => new ApiError(404, message)
export const conflict = (message) => new ApiError(409, message)
export const tooMany = (message) => new ApiError(429, message)

// Express 4 does not forward rejected promises to the error handler, so every
// async route handler is wrapped in this.
export const route = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)
