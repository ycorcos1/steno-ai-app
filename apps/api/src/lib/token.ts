import crypto from "crypto";

/**
 * Generate a cryptographically secure invitation token.
 * Uses 32 random bytes (256 bits) and encodes them as URL-safe Base64.
 */
export function generateInvitationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Validate that a token matches expected Base64 URL-safe format.
 * Requires length >= 43 characters (32 bytes encoded) and only URL-safe characters.
 */
export function isValidInvitationToken(token: string): boolean {
  if (typeof token !== "string" || token.length < 43) {
    return false;
  }

  return /^[A-Za-z0-9_-]+$/.test(token);
}

