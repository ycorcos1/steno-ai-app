import { Pool, QueryResult } from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { retry } from "../lib/retry";
import { generateInvitationToken } from "../lib/token";

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
): Promise<Snapshot | null> {
  const dbPool = await getPool();
  try {
    const result = await dbPool.query<Snapshot>(
      `INSERT INTO doc_snapshots (document_id, version, snapshot_bytes) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (document_id, version) DO NOTHING
       RETURNING id, document_id, version, snapshot_bytes, created_at`,
      [documentId, version, snapshotBytes]
    );
    // If no row returned, it means the snapshot already exists (race condition)
    return result.rows[0] || null;
  } catch (error: any) {
    // Handle duplicate key error gracefully
    if (error.code === "23505") {
      // Unique constraint violation - snapshot already exists
      return null;
    }
    throw error;
  }
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

export interface BasicUserInfo {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Fetch a single user's basic information (name + email)
 */
export async function getUserInfo(
  userId: string
): Promise<BasicUserInfo | null> {
  const dbPool = await getPool();
  const result = await dbPool.query<BasicUserInfo>(
    `SELECT id, email, SPLIT_PART(email, '@', 1) as name
     FROM users
     WHERE id = $1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Fetch basic information for multiple users by their IDs
 */
export async function getUsersByIds(
  userIds: string[]
): Promise<BasicUserInfo[]> {
  if (userIds.length === 0) {
    return [];
  }

  const dbPool = await getPool();
  const result = await dbPool.query<BasicUserInfo>(
    `SELECT id, email, SPLIT_PART(email, '@', 1) as name
     FROM users
     WHERE id = ANY($1)`,
    [userIds]
  );
  return result.rows;
}

// ============================================================================
// INVITATION & COLLABORATOR HELPERS
// ============================================================================

export type InvitationRole = "editor" | "viewer";
export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface Invitation {
  id: string;
  document_id: string;
  inviter_id: string;
  invitee_email: string;
  invitee_user_id: string | null;
  role: InvitationRole;
  status: InvitationStatus;
  token: string;
  expires_at: Date;
  created_at: Date;
  accepted_at: Date | null;
  declined_at: Date | null;
  cancelled_at: Date | null;
}

export interface InvitationWithDetails extends Invitation {
  document_title: string;
  inviter_name: string;
  inviter_email: string;
}

export interface CollaboratorInfo {
  userId: string;
  userName: string;
  email: string;
  role: "owner" | InvitationRole;
  isOwner: boolean;
}

const TOKEN_UNIQUE_CONSTRAINT = "invitations_token_key";
const PENDING_INVITATION_CONSTRAINT = "unique_pending_invitation";

/**
 * Create a new invitation for a document.
 * Retries token generation on collisions up to 5 attempts.
 */
export async function createInvitation(
  documentId: string,
  inviterId: string,
  inviteeEmail: string,
  role: InvitationRole
): Promise<Invitation> {
  const dbPool = await getPool();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateInvitationToken();
    try {
      const result = await dbPool.query<Invitation>(
        `INSERT INTO invitations (
          document_id,
          inviter_id,
          invitee_email,
          role,
          token,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [documentId, inviterId, inviteeEmail, role, token, expiresAt]
      );
      return result.rows[0];
    } catch (error: any) {
      if (
        error.code === "23505" &&
        error.constraint === TOKEN_UNIQUE_CONSTRAINT
      ) {
        continue; // retry with new token
      }

      throw error;
    }
  }

  throw new Error("Failed to generate unique invitation token");
}

/**
 * Get invitation details by token, including document and inviter info.
 */
export async function getInvitationByToken(
  token: string
): Promise<InvitationWithDetails | null> {
  const dbPool = await getPool();
  const result = await dbPool.query<InvitationWithDetails>(
    `SELECT i.*,
            d.title AS document_title,
            SPLIT_PART(u.email, '@', 1) AS inviter_name,
            u.email AS inviter_email
     FROM invitations i
     JOIN documents d ON d.id = i.document_id
     JOIN users u ON u.id = i.inviter_id
     WHERE i.token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

/**
 * Get all pending invitations for a user (by user_id or email).
 */
export async function getInvitationsByUser(
  userId: string,
  email: string
): Promise<InvitationWithDetails[]> {
  const dbPool = await getPool();
  const result = await dbPool.query<InvitationWithDetails>(
    `SELECT i.*,
            d.title AS document_title,
            SPLIT_PART(u.email, '@', 1) AS inviter_name,
            u.email AS inviter_email
     FROM invitations i
     JOIN documents d ON d.id = i.document_id
     JOIN users u ON u.id = i.inviter_id
     WHERE i.status = 'pending'
       AND (i.invitee_user_id = $1 OR LOWER(i.invitee_email) = LOWER($2))
     ORDER BY i.created_at DESC`,
    [userId, email]
  );
  return result.rows;
}

/**
 * Get all invitations for a document (any status).
 */
export async function getInvitationsByDocument(
  documentId: string
): Promise<Invitation[]> {
  const dbPool = await getPool();
  const result = await dbPool.query<Invitation>(
    `SELECT *
     FROM invitations
     WHERE document_id = $1
     ORDER BY created_at DESC`,
    [documentId]
  );
  return result.rows;
}

/**
 * Accept an invitation by token, creating collaborator entry transactionally.
 */
export async function acceptInvitation(
  token: string,
  userId: string
): Promise<{ documentId: string; role: InvitationRole }> {
  const dbPool = await getPool();
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const inviteResult = await client.query<Invitation>(
      `SELECT * FROM invitations
       WHERE token = $1
       FOR UPDATE`,
      [token]
    );

    const invitation = inviteResult.rows[0];
    if (!invitation) {
      throw new Error("INVITATION_NOT_FOUND");
    }

    if (invitation.status !== "pending") {
      throw new Error(`INVITATION_${invitation.status.toUpperCase()}`);
    }

    if (new Date() > invitation.expires_at) {
      await client.query(
        `UPDATE invitations
         SET status = 'expired'
         WHERE id = $1`,
        [invitation.id]
      );
      throw new Error("INVITATION_EXPIRED");
    }

    // Insert collaborator record (idempotent)
    await client.query(
      `INSERT INTO document_collaborators (document_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role`,
      [invitation.document_id, userId, invitation.role]
    );

    await client.query(
      `UPDATE invitations
       SET status = 'accepted',
           accepted_at = CURRENT_TIMESTAMP,
           invitee_user_id = $2
       WHERE id = $1`,
      [invitation.id, userId]
    );

    await client.query("COMMIT");
    return { documentId: invitation.document_id, role: invitation.role };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Decline an invitation by token.
 */
export async function declineInvitation(token: string): Promise<void> {
  const dbPool = await getPool();
  await dbPool.query(
    `UPDATE invitations
     SET status = 'declined',
         declined_at = CURRENT_TIMESTAMP
     WHERE token = $1 AND status = 'pending'`,
    [token]
  );
}

/**
 * Cancel an invitation (owner only).
 */
export async function cancelInvitation(
  invitationId: string,
  documentId: string,
  ownerId: string
): Promise<boolean> {
  const dbPool = await getPool();
  const result = await dbPool.query(
    `UPDATE invitations i
     SET status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP
     FROM documents d
     WHERE i.id = $1
       AND i.document_id = $2
       AND i.document_id = d.id
       AND d.owner_id = $3
       AND i.status = 'pending'`,
    [invitationId, documentId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Resend a pending invitation with a new token (owner only).
 */
export async function resendInvitation(
  invitationId: string,
  documentId: string,
  ownerId: string
): Promise<Invitation | null> {
  const dbPool = await getPool();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateInvitationToken();
    try {
      const result = await dbPool.query<Invitation>(
        `UPDATE invitations i
         SET token = $3,
             expires_at = $4,
             status = 'pending',
             cancelled_at = NULL,
             declined_at = NULL
         FROM documents d
         WHERE i.id = $1
           AND i.document_id = $2
           AND i.document_id = d.id
           AND d.owner_id = $3
          AND i.status = 'pending'
         RETURNING i.*`,
        [invitationId, documentId, ownerId, token, expiresAt]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } catch (error: any) {
      if (
        error.code === "23505" &&
        error.constraint === TOKEN_UNIQUE_CONSTRAINT
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to generate unique invitation token");
}

/**
 * Get collaborator list for a document (owner + collaborators).
 */
export async function getDocumentCollaborators(
  documentId: string
): Promise<CollaboratorInfo[]> {
  const dbPool = await getPool();

  const ownerResult = await dbPool.query<{
    user_id: string;
    email: string;
    name: string | null;
  }>(
    `SELECT u.id AS user_id,
            u.email,
            SPLIT_PART(u.email, '@', 1) AS name
     FROM documents d
     JOIN users u ON u.id = d.owner_id
     WHERE d.id = $1`,
    [documentId]
  );

  if (ownerResult.rows.length === 0) {
    return [];
  }

  const owner = ownerResult.rows[0];

  const collaboratorsResult = await dbPool.query<{
    user_id: string;
    email: string;
    name: string | null;
    role: InvitationRole;
  }>(
    `SELECT u.id AS user_id,
            u.email,
            SPLIT_PART(u.email, '@', 1) AS name,
            dc.role
     FROM document_collaborators dc
     JOIN users u ON u.id = dc.user_id
     WHERE dc.document_id = $1`,
    [documentId]
  );

  const collaborators: CollaboratorInfo[] = [
    {
      userId: owner.user_id,
      userName: owner.name ?? owner.email.split("@")[0],
      email: owner.email,
      role: "owner",
      isOwner: true,
    },
  ];

  for (const row of collaboratorsResult.rows) {
    collaborators.push({
      userId: row.user_id,
      userName: row.name ?? row.email.split("@")[0],
      email: row.email,
      role: row.role,
      isOwner: false,
    });
  }

  return collaborators;
}

/**
 * Remove a collaborator from a document (owner only).
 */
export async function removeCollaborator(
  documentId: string,
  collaboratorId: string,
  ownerId: string
): Promise<boolean> {
  const dbPool = await getPool();
  const result = await dbPool.query(
    `DELETE FROM document_collaborators dc
     USING documents d
     WHERE dc.document_id = $1
       AND dc.user_id = $2
       AND d.id = dc.document_id
       AND d.owner_id = $3`,
    [documentId, collaboratorId, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Update collaborator role (owner only).
 */
export async function updateCollaboratorRole(
  documentId: string,
  collaboratorId: string,
  role: InvitationRole,
  ownerId: string
): Promise<boolean> {
  const dbPool = await getPool();
  const result = await dbPool.query(
    `UPDATE document_collaborators dc
     SET role = $3
     FROM documents d
     WHERE dc.document_id = $1
       AND dc.user_id = $2
       AND d.id = dc.document_id
       AND d.owner_id = $4`,
    [documentId, collaboratorId, role, ownerId]
  );
  return (result.rowCount ?? 0) > 0;
}
