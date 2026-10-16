import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../utils/errors.js'
import { ZodError } from 'zod'

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        type: err.type,
        message: err.message,
        code: err.code,
      },
    })
    return
  }

  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
    res.status(400).json({
      error: {
        type: 'validation_error',
        message,
        code: 'invalid_request',
      },
    })
    return
  }

  console.error('Unhandled error:', err)
  res.status(500).json({
    error: {
      type: 'internal_error',
      message: 'An unexpected error occurred',
      code: 'internal_error',
    },
  })
}
