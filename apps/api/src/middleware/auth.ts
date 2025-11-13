import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
      };
    }
  }
}

let jwtSecret: string | null = null;
let secretInitPromise: Promise<string> | null = null;

/**
 * Get JWT secret from Secrets Manager or environment variable
 * Caches the secret after first retrieval
 */
async function getJwtSecret(): Promise<string> {
  if (jwtSecret) {
    return jwtSecret;
  }

  if (secretInitPromise) {
    jwtSecret = await secretInitPromise;
    return jwtSecret;
  }

  secretInitPromise = (async () => {
    const region = process.env.REGION || "us-east-1";
    const env = process.env.ENV || "dev";
    // JWT secret is always in the app secret, not the db secret
    const secretName = `/stenoai/${env}/app`;

    // Try to load from Secrets Manager (production)
    try {
      const vpcEndpointDns = process.env.SECRETS_MANAGER_ENDPOINT;
      const secretsClient = new SecretsManagerClient({
        region,
        endpoint: vpcEndpointDns ? `https://${vpcEndpointDns}` : undefined,
        requestHandler: {
          requestTimeout: 5000,
        },
      });

      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await secretsClient.send(command);

      if (response.SecretString) {
        const secretData = JSON.parse(response.SecretString);
        if (secretData.JWT_SECRET) {
          console.log("JWT secret loaded from Secrets Manager");
          return secretData.JWT_SECRET;
        }
      }
    } catch (error) {
      console.warn(
        `Failed to load JWT secret from Secrets Manager: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      console.warn("Falling back to environment variable");
    }

    // Fallback to environment variable (development/local)
    const envSecret = process.env.JWT_SECRET;
    if (envSecret) {
      console.log("JWT secret loaded from environment variable");
      return envSecret;
    }

    // Last resort: dev-only default (should never be used in production)
    const devSecret = "dev-secret-change-in-production";
    console.warn(
      "WARNING: Using default JWT secret. Set JWT_SECRET in environment or Secrets Manager!"
    );
    return devSecret;
  })();

  jwtSecret = await secretInitPromise;
  secretInitPromise = null;
  return jwtSecret;
}

/**
 * Middleware to authenticate requests using JWT from httpOnly cookie
 * Attaches user info to req.user if token is valid
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip authentication for OPTIONS requests (CORS preflight)
  if (req.method === "OPTIONS") {
    return next();
  }

  try {
    // Try to get token from cookie first, then from Authorization header
    let token = req.cookies?.auth_token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      email: string;
    };

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
    };

    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
    } else {
      console.error("Authentication error:", err);
      res.status(500).json({ error: "Authentication failed" });
    }
  }
}
