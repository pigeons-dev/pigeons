export class AppError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: string = 'validation_error') {
    super('validation_error', message, code, 400)
  }
}

export class AuthError extends AppError {
  constructor(message: string = 'Invalid or missing API key') {
    super('authentication_error', message, 'unauthorized', 401)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('not_found', `${resource} '${id}' not found`, 'not_found', 404)
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('rate_limit_error', 'Rate limit exceeded', 'rate_limited', 429)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', message, 'conflict', 409)
  }
}
