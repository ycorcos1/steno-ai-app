import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

/**
 * Custom error classes for better error handling
 */
export class ValidationError extends Error {
  statusCode = 400;
  code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  code = "NOT_FOUND";

  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  statusCode = 401;
  code = "UNAUTHORIZED";

  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  statusCode = 403;
  code = "FORBIDDEN";

  constructor(message: string = "Access denied") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  statusCode = 409;
  code = "CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends Error {
  statusCode = 429;
  code = "RATE_LIMIT_EXCEEDED";

  constructor(message: string = "Too many requests") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class ServiceUnavailableError extends Error {
  statusCode = 503;
  code = "SERVICE_UNAVAILABLE";

  constructor(message: string = "Service temporarily unavailable") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * Map error to HTTP status code and error code
 */
function mapErrorToResponse(error: any): {
  statusCode: number;
  code: string;
  message: string;
} {
  // Custom error classes
  if (error instanceof ValidationError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof NotFoundError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof UnauthorizedError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ForbiddenError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ConflictError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof RateLimitError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ServiceUnavailableError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }

  // JWT errors
  if (error instanceof jwt.TokenExpiredError) {
    return {
      statusCode: 401,
      code: "TOKEN_EXPIRED",
      message: "Token expired",
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return {
      statusCode: 401,
      code: "INVALID_TOKEN",
      message: "Invalid token",
    };
  }

  // AWS SDK errors
  if (
    error.code === "ThrottlingException" ||
    error.name === "ThrottlingException"
  ) {
    return {
      statusCode: 429,
      code: "BEDROCK_THROTTLED",
      message: "AI service is currently busy. Please try again shortly.",
    };
  }

  if (
    error.code === "ServiceUnavailable" ||
    error.name === "ServiceUnavailable"
  ) {
    return {
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable",
    };
  }

  // Database connection errors
  if (error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
    return {
      statusCode: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "Database connection failed",
    };
  }

  // Network errors
  if (error.code === "ENOTFOUND" || error.code === "ECONNRESET") {
    return {
      statusCode: 503,
      code: "NETWORK_ERROR",
      message: "Network error occurred",
    };
  }

  // Default to 500
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: error.message || "An unexpected error occurred",
  };
}

/**
 * Global error handler middleware
 * Must be registered last in the Express middleware chain
 *
 * @example
 * ```typescript
 * app.use(errorHandler);
 * ```
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Generate request ID for tracing
  const requestId = uuidv4();

  // Map error to response format
  const { statusCode, code, message } = mapErrorToResponse(err);

  // Log error with context
  const logContext = {
    requestId,
    userId: (req as any).user?.userId || "anonymous",
    path: req.path,
    method: req.method,
    error: {
      name: err.name,
      message: err.message,
      code,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
    },
  };

  if (statusCode >= 500) {
    // Log server errors as errors
    console.error("Server error:", JSON.stringify(logContext, null, 2));
  } else {
    // Log client errors as warnings
    console.warn("Client error:", JSON.stringify(logContext, null, 2));
  }

  // Send error response
  res.status(statusCode).json({
    error: message,
    code,
    requestId,
  });
}

/**
 * Async error wrapper for route handlers
 * Catches async errors and passes them to error handler
 *
 * @example
 * ```typescript
 * router.post('/route', authenticateToken, asyncHandler(async (req, res) => {
 *   // Your async code here
 * }));
 * ```
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
