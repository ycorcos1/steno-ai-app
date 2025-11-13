import express, { Request, Response } from "express";
import serverless from "serverless-http";
import cookieParser from "cookie-parser";
import storageRouter from "./routes/storage";
import ingestRouter from "./routes/ingest";
import authRouter from "./routes/auth";
import { authenticateToken } from "./middleware/auth";
import templatesRouter from "./routes/templates";
import promptsRouter from "./routes/prompts";
import generateRouter from "./routes/generate";
import refineRouter from "./routes/refine";
import exportRouter from "./routes/export";
import { query } from "./db/pg";
import { errorHandler } from "./middleware/errors";
import { idempotencyMiddleware } from "./middleware/idempotency";

const app = express();
app.use(express.json());
app.use(cookieParser());

// Handle CORS preflight OPTIONS requests
// This is a fallback - API Gateway HTTP API v2 should handle CORS automatically
app.options("*", (req: Request, res: Response) => {
  const origin = req.headers.origin;
  // Allow the CloudFront origin or any origin in development
  const allowedOrigins = [
    "https://d2m2ob9ztbwghm.cloudfront.net",
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (!origin || process.env.NODE_ENV !== "production") {
    res.header("Access-Control-Allow-Origin", "*");
  } else {
    res.header("Access-Control-Allow-Origin", allowedOrigins[0]);
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,Accept,Origin,Idempotency-Key"
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "300");
  res.sendStatus(204);
});

// Health endpoint - handle both /health and /{stage}/health
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Also handle stage-prefixed routes for HTTP API v2
app.get("/:stage/health", (req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Database health endpoint
app.get("/health/db", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT 1 as status");
    res.json({ db: "ok", connected: true });
  } catch (err) {
    console.error("Database health check failed:", err);
    res.status(503).json({
      db: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Also handle stage-prefixed version
app.get("/:stage/health/db", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT 1 as status");
    res.json({ db: "ok", connected: true });
  } catch (err) {
    console.error("Database health check failed:", err);
    res.status(503).json({
      db: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Auth routes - handle both with and without stage prefix
app.use("/auth", authRouter);
app.use("/:stage/auth", authRouter);

// Test protected route (for PR #7 verification)
app.get("/test-protected", authenticateToken, (req: Request, res: Response) => {
  res.json({
    message: "Protected route works",
    user: req.user,
  });
});

app.get(
  "/:stage/test-protected",
  authenticateToken,
  (req: Request, res: Response) => {
    res.json({
      message: "Protected route works",
      user: req.user,
    });
  }
);

// Storage routes (presigned URLs) - handle both with and without stage prefix
app.use("/documents", storageRouter);
app.use("/:stage/documents", storageRouter);

// Ingest routes (protected) - handle both with and without stage prefix
app.use("/documents", ingestRouter);
app.use("/:stage/documents", ingestRouter);

// Template routes - handle both with and without stage prefix
app.use("/templates", templatesRouter);
app.use("/:stage/templates", templatesRouter);

// Prompts routes - handle both with and without stage prefix
app.use("/prompts", promptsRouter);
app.use("/:stage/prompts", promptsRouter);

// Generate routes (draft generation) - handle both with and without stage prefix
// Apply idempotency middleware to POST routes
app.use("/documents", generateRouter);
app.use("/:stage/documents", generateRouter);

// Refine routes (AI refinement) - handle both with and without stage prefix
// Apply idempotency middleware to POST routes
app.use("/ai", refineRouter);
app.use("/:stage/ai", refineRouter);
app.use("/documents", refineRouter);
app.use("/:stage/documents", refineRouter);

// Export routes - handle both with and without stage prefix
// Apply idempotency middleware to POST routes
app.use("/documents", exportRouter);
app.use("/:stage/documents", exportRouter);
app.use("/", exportRouter);
app.use("/:stage/", exportRouter);

// Temporary migration endpoint (for PR #6 - remove after migration is complete)
// POST /migrate - Execute migration SQL
app.post("/migrate", async (req: Request, res: Response) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== "string") {
      return res
        .status(400)
        .json({ error: "SQL content required in body.sql" });
    }

    // Execute the migration SQL
    await query(sql);
    res.json({ success: true, message: "Migration executed successfully" });
  } catch (err) {
    console.error("Migration execution failed:", err);
    res.status(500).json({
      error: "Migration failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Also handle stage-prefixed version
app.post("/:stage/migrate", async (req: Request, res: Response) => {
  try {
    const { sql } = req.body;
    if (!sql || typeof sql !== "string") {
      return res
        .status(400)
        .json({ error: "SQL content required in body.sql" });
    }

    await query(sql);
    res.json({ success: true, message: "Migration executed successfully" });
  } catch (err) {
    console.error("Migration execution failed:", err);
    res.status(500).json({
      error: "Migration failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Global error handler - MUST be registered last
app.use(errorHandler);

export const handler = serverless(app);

// Local development server (only runs if not in Lambda environment)
if (process.env.NODE_ENV !== "production" && require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Local API server running on http://localhost:${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/health`);
  });
}
