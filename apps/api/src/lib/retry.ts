/**
 * Retry utility with exponential backoff
 * Handles transient failures for AWS SDK operations (Bedrock, S3, Secrets Manager, etc.)
 */

export interface RetryConfig {
  maxAttempts: number; // Default: 5
  initialDelayMs: number; // Default: 100
  maxDelayMs: number; // Default: 10000
  backoffMultiplier: number; // Default: 2
  retryableErrors?: string[]; // AWS error codes to retry (e.g., ['ThrottlingException', 'ServiceUnavailable'])
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    "ThrottlingException",
    "ServiceUnavailable",
    "TooManyRequestsException",
    "RequestTimeout",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
  ],
};

/**
 * Check if an error is retryable based on error code or message
 */
function isRetryableError(error: any, retryableErrors: string[]): boolean {
  if (!error) return false;

  // Check AWS SDK error structure
  const errorCode = error.code || error.name || error.$metadata?.httpStatusCode;
  const errorMessage = error.message || String(error);

  // Check if error code matches retryable list
  if (errorCode && retryableErrors.some((code) => errorCode.includes(code))) {
    return true;
  }

  // Check if error message contains retryable keywords
  if (
    errorMessage &&
    retryableErrors.some((code) => errorMessage.includes(code))
  ) {
    return true;
  }

  // Check for network errors
  if (
    errorCode === "ECONNRESET" ||
    errorCode === "ETIMEDOUT" ||
    errorCode === "ENOTFOUND"
  ) {
    return true;
  }

  // Check for HTTP 429, 503, 502, 504
  const statusCode = error.statusCode || error.$metadata?.httpStatusCode;
  if (
    statusCode === 429 ||
    statusCode === 503 ||
    statusCode === 502 ||
    statusCode === 504
  ) {
    return true;
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1),
    config.maxDelayMs
  );

  // Add jitter (0-25% variance) to prevent thundering herd
  const jitter = Math.random() * 0.25 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 *
 * @param operation Async function to retry
 * @param config Optional retry configuration
 * @returns Result of the operation
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * import { retry } from '../lib/retry';
 *
 * const result = await retry(
 *   async () => bedrockClient.send(new InvokeModelCommand({ ... })),
 *   { maxAttempts: 5, initialDelayMs: 100 }
 * );
 * ```
 */
export async function retry<T>(
  operation: () => Promise<T>,
  config?: Partial<RetryConfig>
): Promise<T> {
  const finalConfig: RetryConfig = { ...DEFAULT_CONFIG, ...config };
  const retryableErrors =
    finalConfig.retryableErrors || DEFAULT_CONFIG.retryableErrors || [];

  let lastError: any;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      const result = await operation();

      // Log success after retries
      if (attempt > 1) {
        console.log(`Retry succeeded on attempt ${attempt}`);
      }

      return result;
    } catch (error: any) {
      lastError = error;

      // Check if error is retryable
      if (!isRetryableError(error, retryableErrors)) {
        console.error(`Non-retryable error on attempt ${attempt}:`, error);
        throw error;
      }

      // Don't retry on last attempt
      if (attempt >= finalConfig.maxAttempts) {
        console.error(`Retry exhausted after ${attempt} attempts:`, error);
        break;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, finalConfig);
      console.warn(
        `Retry attempt ${attempt}/${finalConfig.maxAttempts} after ${delay}ms. Error:`,
        error.code || error.name || error.message || String(error)
      );

      await sleep(delay);
    }
  }

  // All retries exhausted
  throw lastError;
}
