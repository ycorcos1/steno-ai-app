import { Request, Response, NextFunction } from "express";

/**
 * In-memory store for idempotency keys
 * MVP implementation - consider migrating to RDS for multi-instance production
 */
interface IdempotencyEntry {
  statusCode: number;
  body: any;
  timestamp: number;
}

const idempotencyStore = new Map<string, IdempotencyEntry>();

// TTL for idempotency keys: 24 hours
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up expired entries from the idempotency store
 * Called periodically to prevent memory leaks
 */
function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore.entries()) {
    if (now - entry.timestamp > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredEntries, 60 * 60 * 1000);

/**
 * Idempotency middleware
 * Prevents duplicate POST requests using Idempotency-Key header
 *
 * Workflow:
 * 1. Extract Idempotency-Key from headers (required for POST routes)
 * 2. If key exists and < 24h old → return cached response
 * 3. If key missing → return 400 "Idempotency-Key header required"
 * 4. Otherwise, execute request and store response before returning
 *
 * @example
 * ```typescript
 * app.post('/documents/generate',
 *   authenticateToken,
 *   idempotencyMiddleware,
 *   generateHandler
 * );
 * ```
 */
export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only apply to POST, PUT, PATCH methods
  if (!["POST", "PUT", "PATCH"].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers["idempotency-key"] as string;

  // Require idempotency key for POST/PUT/PATCH
  if (!idempotencyKey) {
    res.status(400).json({
      error: "Idempotency-Key header required",
      code: "MISSING_IDEMPOTENCY_KEY",
    });
    return;
  }

  // Validate key format (should be UUID or similar)
  // Allow alphanumeric, hyphens, underscores, length 1-255
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(idempotencyKey)) {
    res.status(400).json({
      error: "Invalid Idempotency-Key format",
      code: "INVALID_IDEMPOTENCY_KEY",
    });
    return;
  }

  // Check if we have a cached response
  const cachedEntry = idempotencyStore.get(idempotencyKey);
  const now = Date.now();

  if (cachedEntry) {
    // Check if entry is still valid (not expired)
    if (now - cachedEntry.timestamp < IDEMPOTENCY_TTL_MS) {
      // Return cached response
      console.log(`Idempotency cache hit for key: ${idempotencyKey}`);
      res.status(cachedEntry.statusCode).json(cachedEntry.body);
      return;
    } else {
      // Entry expired, remove it
      idempotencyStore.delete(idempotencyKey);
    }
  }

  // No cached response - proceed with request
  // Intercept the response to cache it
  const originalJson = res.json.bind(res);
  const originalStatus = res.status.bind(res);

  let responseStatus = 200;
  let responseBody: any = null;

  // Override res.status() to capture status code
  res.status = function (code: number) {
    responseStatus = code;
    return originalStatus(code);
  };

  // Override res.json() to capture response body
  res.json = function (body: any) {
    responseBody = body;

    // Only cache successful responses (2xx)
    if (responseStatus >= 200 && responseStatus < 300) {
      idempotencyStore.set(idempotencyKey, {
        statusCode: responseStatus,
        body: responseBody,
        timestamp: now,
      });
      console.log(`Idempotency cache set for key: ${idempotencyKey}`);
    }

    return originalJson(body);
  };

  // Continue to next middleware/handler
  next();
}

/**
 * Get current idempotency store size (for monitoring/debugging)
 */
export function getIdempotencyStoreSize(): number {
  return idempotencyStore.size;
}

/**
 * Clear all idempotency entries (for testing)
 */
export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
}
