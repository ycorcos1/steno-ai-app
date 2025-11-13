import { Pool, QueryResult } from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { retry } from "../lib/retry";

let pool: Pool | null = null;
let initPromise: Promise<Pool> | null = null;

interface DbCredentials {
  PGHOST: string;
  PGDATABASE: string;
  PGUSER: string;
  PGPASSWORD: string;
}

/**
 * Initialize the database connection pool by fetching credentials from Secrets Manager
 */
async function initPool(): Promise<Pool> {
  const region = process.env.REGION || "us-east-1";
  const env = process.env.ENV || "dev";
  const secretName = process.env.SECRETS_PATH || `/stenoai/${env}/db`;

  console.log(`Initializing database pool, fetching secret: ${secretName}`);

  // In VPC with private DNS enabled, the SDK should auto-resolve
  // secretsmanager.region.amazonaws.com to the VPC endpoint
  // However, if that fails, we can try the explicit VPC endpoint DNS
  const vpcEndpointDns = process.env.SECRETS_MANAGER_ENDPOINT;

  if (vpcEndpointDns) {
    console.log(`Using explicit VPC endpoint: https://${vpcEndpointDns}`);
  } else {
    console.log(
      `Using default endpoint (should auto-resolve to VPC endpoint via private DNS)`
    );
  }

  const secretsClient = new SecretsManagerClient({
    region,
    endpoint: vpcEndpointDns ? `https://${vpcEndpointDns}` : undefined,
    requestHandler: {
      requestTimeout: 8000, // 8 second timeout - fail fast
    },
  });

  try {
    console.log(
      `Fetching secret from Secrets Manager (region: ${region}, timeout: 8s)...`
    );
    const startTime = Date.now();
    const command = new GetSecretValueCommand({ SecretId: secretName });

    const response = await secretsClient.send(command);

    const duration = Date.now() - startTime;
    console.log(`Secret retrieved successfully in ${duration}ms`);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no SecretString value`);
    }

    const credentials: DbCredentials = JSON.parse(response.SecretString);

    if (
      !credentials.PGHOST ||
      !credentials.PGDATABASE ||
      !credentials.PGUSER ||
      !credentials.PGPASSWORD
    ) {
      throw new Error(`Invalid credentials structure in secret ${secretName}`);
    }

    const newPool = new Pool({
      host: credentials.PGHOST,
      database: credentials.PGDATABASE,
      user: credentials.PGUSER,
      password: credentials.PGPASSWORD,
      max: 2, // Limit connections per Lambda instance
      idleTimeoutMillis: 30000, // 30 seconds
      connectionTimeoutMillis: 5000, // 5 seconds (reduced for faster failure)
      ssl: {
        rejectUnauthorized: false, // RDS uses SSL by default
      },
    });

    // Test connection
    console.log(`Testing database connection to ${credentials.PGHOST}...`);
    await newPool.query("SELECT 1");
    console.log(`Database connection successful`);

    return newPool;
  } catch (error) {
    console.error("Failed to initialize database pool:", error);
    throw new Error(
      `Database initialization failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Get or initialize the database connection pool
 */
async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  if (initPromise) {
    pool = await initPromise;
    return pool;
  }

  initPromise = initPool();
  pool = await initPromise;
  initPromise = null;

  return pool;
}

/**
 * Execute a database query with retry logic for transient failures
 * @param text SQL query text
 * @param params Query parameters
 * @returns Query result
 */
export async function query(
  text: string,
  params?: any[]
): Promise<QueryResult> {
  const dbPool = await getPool();

  // Retry database queries on transient connection errors
  return retry(async () => dbPool.query(text, params), {
    maxAttempts: 3,
    initialDelayMs: 100,
    retryableErrors: ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"],
  });
}

/**
 * Get the connection pool (for health checks and advanced operations)
 * @returns Database connection pool
 */
export async function getPoolInstance(): Promise<Pool> {
  return getPool();
}

/**
 * Close the database connection pool
 * Useful for cleanup in tests or graceful shutdowns
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    initPromise = null;
  }
}

// ============================================================================
// COLLABORATION HELPER FUNCTIONS
// ============================================================================

export interface Snapshot {
  id: string;
  document_id: string;
  version: number;
  snapshot_bytes: Buffer;
  created_at: Date;
}

export interface DocOp {
  id: string;
  document_id: string;
  op_bytes: Buffer;
  created_at: Date;
  session_id: string | null;
}

/**
 * Get the latest snapshot for a document
 * @param documentId Document ID
 * @returns Latest snapshot or null if none exists
 */
export async function getLatestSnapshot(
  documentId: string
): Promise<Snapshot | null> {
  const dbPool = await getPool();
  const result = await dbPool.query<Snapshot>(
    `SELECT id, document_id, version, snapshot_bytes, created_at 
     FROM doc_snapshots 
     WHERE document_id = $1 
     ORDER BY version DESC 
     LIMIT 1`,
    [documentId]
  );
  return result.rows[0] || null;
}

/**
 * Get all operations since a specific snapshot version
 * @param documentId Document ID
 * @param version Snapshot version (if null, returns all ops)
 * @returns Array of operations
 */
export async function getOpsSince(
  documentId: string,
  version: number | null
): Promise<DocOp[]> {
  const dbPool = await getPool();

  if (version === null) {
    // Return all ops if no snapshot version provided
    const result = await dbPool.query<DocOp>(
      `SELECT id, document_id, op_bytes, created_at, session_id 
       FROM doc_ops 
       WHERE document_id = $1 
       ORDER BY created_at ASC`,
      [documentId]
    );
    return result.rows;
  }

  // Get ops created after the snapshot
  const result = await dbPool.query<DocOp>(
    `SELECT id, document_id, op_bytes, created_at, session_id 
     FROM doc_ops 
     WHERE document_id = $1 
       AND created_at > (
         SELECT created_at 
         FROM doc_snapshots 
         WHERE document_id = $1 AND version = $2
       )
     ORDER BY created_at ASC`,
    [documentId, version]
  );
  return result.rows;
}

/**
 * Save a snapshot for a document
 * @param documentId Document ID
 * @param version Snapshot version number
 * @param snapshotBytes Y.js encoded snapshot bytes
 * @returns Created snapshot
 */
export async function saveSnapshot(
  documentId: string,
  version: number,
  snapshotBytes: Buffer
): Promise<Snapshot> {
  const dbPool = await getPool();
  const result = await dbPool.query<Snapshot>(
    `INSERT INTO doc_snapshots (document_id, version, snapshot_bytes) 
     VALUES ($1, $2, $3) 
     RETURNING id, document_id, version, snapshot_bytes, created_at`,
    [documentId, version, snapshotBytes]
  );
  return result.rows[0];
}

/**
 * Save an operation to the operations log
 * @param documentId Document ID
 * @param opBytes Y.js operation bytes
 * @param sessionId WebSocket session/connection ID
 * @returns Created operation
 */
export async function saveOp(
  documentId: string,
  opBytes: Buffer,
  sessionId: string
): Promise<DocOp> {
  const dbPool = await getPool();
  const result = await dbPool.query<DocOp>(
    `INSERT INTO doc_ops (document_id, op_bytes, session_id) 
     VALUES ($1, $2, $3) 
     RETURNING id, document_id, op_bytes, created_at, session_id`,
    [documentId, opBytes, sessionId]
  );
  return result.rows[0];
}

/**
 * Get the next snapshot version number for a document
 * @param documentId Document ID
 * @returns Next version number (1 if no snapshots exist)
 */
export async function getNextSnapshotVersion(
  documentId: string
): Promise<number> {
  const dbPool = await getPool();
  const result = await dbPool.query<{ max_version: number | null }>(
    `SELECT MAX(version) as max_version 
     FROM doc_snapshots 
     WHERE document_id = $1`,
    [documentId]
  );
  const maxVersion = result.rows[0]?.max_version;
  return maxVersion === null ? 1 : maxVersion + 1;
}

/**
 * Count operations since the last snapshot
 * @param documentId Document ID
 * @returns Count of operations since last snapshot
 */
export async function countOpsSinceLastSnapshot(
  documentId: string
): Promise<number> {
  const dbPool = await getPool();
  const result = await dbPool.query<{ count: string }>(
    `SELECT COUNT(*) as count 
     FROM doc_ops 
     WHERE document_id = $1 
       AND created_at > COALESCE(
         (SELECT created_at 
          FROM doc_snapshots 
          WHERE document_id = $1 
          ORDER BY version DESC 
          LIMIT 1),
         '1970-01-01'::timestamp
       )`,
    [documentId]
  );
  return parseInt(result.rows[0]?.count || "0", 10);
}

/**
 * Check if user has access to a document (owner or collaborator)
 * @param documentId Document ID
 * @param userId User ID
 * @returns Access role ('owner', 'editor', 'viewer') or null if no access
 */
export async function checkDocumentAccess(
  documentId: string,
  userId: string
): Promise<"owner" | "editor" | "viewer" | null> {
  const dbPool = await getPool();

  // Check if user is owner
  const ownerResult = await dbPool.query<{ owner_id: string }>(
    `SELECT owner_id FROM documents WHERE id = $1`,
    [documentId]
  );

  if (ownerResult.rows[0]?.owner_id === userId) {
    return "owner";
  }

  // Check collaborators table
  const collabResult = await dbPool.query<{ role: string }>(
    `SELECT role FROM document_collaborators 
     WHERE document_id = $1 AND user_id = $2`,
    [documentId, userId]
  );

  if (collabResult.rows.length > 0) {
    const role = collabResult.rows[0].role;
    if (role === "editor" || role === "viewer") {
      return role as "editor" | "viewer";
    }
  }

  // MVP: Only owner has access (no collaborators by default)
  return null;
}
