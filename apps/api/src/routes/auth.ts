import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db/pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const router = Router();
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "24h";
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours in ms

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
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

/**
 * POST /auth/signup
 * Create a new user account
 */
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    if (!isValidEmail(email)) {
      res.status(400).json({ error: "Invalid email format" });
      return;
    }

    if (!isValidPassword(password)) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    // Normalize email (trim and lowercase)
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user exists
    const existingUser = await query(
      "SELECT COUNT(*) as count FROM users WHERE LOWER(TRIM(email)) = $1",
      [normalizedEmail]
    );
    if (parseInt(existingUser.rows[0].count) > 0) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user with normalized email
    const result = await query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
      [normalizedEmail, passwordHash]
    );

    const user = result.rows[0];

    // Generate JWT
    const secret = await getJwtSecret();
    const token = jwt.sign({ userId: user.id, email: user.email }, secret, {
      expiresIn: TOKEN_EXPIRY,
    });

    // Set httpOnly cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax", // "none" for cross-site in production, "lax" for same-site in dev
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    res.status(201).json({
      message: "User created successfully",
      token: token, // Include token in response for frontend to store if cookie fails
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
});

/**
 * POST /auth/login
 * Authenticate user and return JWT token
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    console.log("Login attempt received");
    const { email, password } = req.body;
    console.log(
      `Login attempt for email: ${
        email ? email.substring(0, 5) + "..." : "missing"
      }`
    );

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    // Trim and lowercase email for consistency
    const normalizedEmail = email.trim().toLowerCase();
    console.log(`Normalized email: ${normalizedEmail}`);

    // Find user
    console.log(`Querying database for user: ${normalizedEmail}`);
    const result = await query(
      "SELECT id, email, password_hash, created_at FROM users WHERE LOWER(TRIM(email)) = $1",
      [normalizedEmail]
    );
    console.log(`Query returned ${result.rows.length} row(s)`);

    if (result.rows.length === 0) {
      console.error(
        `Login failed: User not found for email ${normalizedEmail}`
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const user = result.rows[0];

    // Verify password
    console.log(`Verifying password for user: ${user.email}`);
    const isValid = await bcrypt.compare(password, user.password_hash);
    console.log(`Password verification result: ${isValid}`);
    if (!isValid) {
      console.error(
        `Login failed: Password mismatch for email ${normalizedEmail}`
      );
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    console.log(`Password verified successfully for ${normalizedEmail}`);

    // Generate JWT
    const secret = await getJwtSecret();
    const token = jwt.sign({ userId: user.id, email: user.email }, secret, {
      expiresIn: TOKEN_EXPIRY,
    });

    // Set httpOnly cookie
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax", // "none" for cross-site in production, "lax" for same-site in dev
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    console.log(`Login successful for ${normalizedEmail}, setting cookie`);
    // Also return token in response body as fallback if cookie doesn't work
    res.json({
      message: "Login successful",
      token: token, // Include token in response for frontend to store if cookie fails
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
    console.log(`Login response sent for ${normalizedEmail}`);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * POST /auth/logout
 * Clear authentication cookie
 */
router.post("/logout", (req: Request, res: Response) => {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax", // "none" for cross-site in production, "lax" for same-site in dev
    path: "/",
  });
  res.json({ message: "Logged out successfully" });
});

/**
 * GET /auth/me
 * Get current authenticated user from JWT token
 */
router.get("/me", async (req: Request, res: Response) => {
  try {
    console.log("GET /auth/me called");
    console.log("Cookies received:", Object.keys(req.cookies || {}));
    // Try to get token from cookie first, then from Authorization header
    let token = req.cookies?.auth_token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
        console.log("Auth token found in Authorization header");
      }
    }
    console.log("Auth token present:", !!token);

    if (!token) {
      console.log("No auth token found in cookies or Authorization header");
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      email: string;
    };

    // Fetch user from database to get latest info
    const result = await query(
      "SELECT id, email, created_at FROM users WHERE id = $1",
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
    } else {
      console.error("Get user error:", err);
      res.status(500).json({ error: "Failed to get user" });
    }
  }
});

/**
 * GET /auth/ws-token
 * Get JWT token for WebSocket connections
 * Returns the same JWT that's in the httpOnly cookie, for use in WebSocket query params
 */
router.get("/ws-token", async (req: Request, res: Response) => {
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

    // Verify token is valid
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      email: string;
    };

    // Return the token (client will use it in WebSocket connection)
    res.json({ token });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: "Token expired" });
    } else if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: "Invalid token" });
    } else {
      console.error("Get WebSocket token error:", err);
      res.status(500).json({ error: "Failed to get WebSocket token" });
    }
  }
});

export default router;
