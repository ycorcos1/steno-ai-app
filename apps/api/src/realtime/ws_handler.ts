import {
  APIGatewayProxyWebsocketHandlerV2,
  APIGatewayProxyWebsocketEventV2,
  Context,
} from "aws-lambda";
import jwt from "jsonwebtoken";
import {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { joinRoom, saveOperation, createSnapshot } from "./persist";
import {
  ConnectionRecord,
  deleteConnection,
  getConnection,
  getConnectionsByDocument,
  getConnectionsByUser,
  getDocumentConnectionCount,
  getUserConnectionCount,
  listAllConnections,
  saveConnection,
  setConnectionDocument,
  updateConnectionActivity,
  cleanupStaleUserConnections,
} from "./connections";
import { validateMessage, validateRawMessageSize } from "./validation";
import { getUserInfo, checkDocumentAccess } from "../db/pg";

const USER_CONNECTION_LIMIT = 10;
const DOCUMENT_CONNECTION_LIMIT = 100;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const MAX_MISSED_PINGS = 3;

// JWT secret cache (same pattern as auth.ts)
let jwtSecret: string | null = null;
let secretInitPromise: Promise<string> | null = null;

const apiGatewayClientCache = new Map<string, ApiGatewayManagementApiClient>();
const pendingPings = new Map<string, number>();
const missedPings = new Map<string, number>();
let lastHeartbeatRun = 0;

type RateLimiterState = {
  tokens: number;
  lastRefill: number;
  limit: number;
  refillMs: number;
};

const rateLimiters = new Map<string, RateLimiterState>();
const RATE_LIMITS: Record<string, { limit: number; refillMs: number }> = {
  update: { limit: 500, refillMs: 1000 }, // Increased for real-time typing
  presence: { limit: 20, refillMs: 1000 }, // Increased for typing indicators
  create_snapshot: { limit: 1, refillMs: 60_000 },
  join: { limit: 5, refillMs: 60_000 },
  ping: { limit: 10, refillMs: 1000 },
  pong: { limit: 20, refillMs: 1000 },
};

/**
 * Get JWT secret from Secrets Manager or environment variable
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
    const secretName = process.env.SECRETS_PATH || `/stenoai/${env}/app`;

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
    }

    const envSecret = process.env.JWT_SECRET;
    if (envSecret) {
      console.log("JWT secret loaded from environment variable");
      return envSecret;
    }

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
 * Verify JWT token from query parameter
 */
async function verifyJWT(token: string | null): Promise<{
  userId: string;
  email: string;
} | null> {
  if (!token) {
    return null;
  }

  try {
    const secret = await getJwtSecret();
    const decoded = jwt.verify(token, secret) as {
      userId: string;
      email: string;
    };
    return decoded;
  } catch (err) {
    console.error("JWT verification failed:", err);
    return null;
  }
}

function getEndpointFromEvent(event: APIGatewayProxyWebsocketEventV2): string {
  return `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
}

function getApiGatewayClient(endpoint: string) {
  if (apiGatewayClientCache.has(endpoint)) {
    return apiGatewayClientCache.get(endpoint)!;
  }

  const client = new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.REGION || "us-east-1",
    requestHandler: {
      requestTimeout: 5000, // 5 second timeout - fail fast
    },
  });
  apiGatewayClientCache.set(endpoint, client);
  return client;
}

const MAX_WS_MESSAGE_BYTES = 28 * 1024; // Match client/server validation limit

async function sendToConnection(options: {
  connectionId: string;
  data: any;
  client?: ApiGatewayManagementApiClient;
  endpoint?: string;
}) {
  const { connectionId, data } = options;
  const client =
    options.client ||
    (options.endpoint ? getApiGatewayClient(options.endpoint) : null);

  if (!client) {
    throw new Error("API Gateway client is required");
  }

  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    });
    // Use Promise.race to enforce a timeout
    await Promise.race([
      client.send(command),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Send timeout")), 5000)
      ),
    ]);
  } catch (error) {
    if (isGoneError(error)) {
      await deleteConnection(connectionId);
    } else {
      // Don't log timeout errors for old/stale connections - they're expected
      const isTimeout = error instanceof Error && 
        (error.message.includes("timeout") || error.message.includes("ETIMEDOUT"));
      if (!isTimeout) {
      console.error(`Failed to send to connection ${connectionId}:`, error);
    }
      // Silently delete stale connections that timeout
      if (isTimeout) {
        await deleteConnection(connectionId).catch(() => {
          // Ignore errors when deleting
        });
      }
    }
  }
}

async function sendChunkedSyncPayload(options: {
  client: ApiGatewayManagementApiClient;
  connectionId: string;
  snapshot: Buffer | null;
  ops: Buffer[];
  version: number | null;
}) {
  const { client, connectionId, snapshot, ops, version } = options;

  const snapshotBase64 = snapshot ? snapshot.toString("base64") : null;
  const opStrings = ops.map((op) => op.toString("base64"));

  // Attempt to send in a single message first for efficiency
  const singlePayload = {
    type: "sync",
    snapshot: snapshotBase64,
    ops: opStrings,
    version,
  };

  if (
    Buffer.byteLength(JSON.stringify(singlePayload), "utf8") <=
    MAX_WS_MESSAGE_BYTES
  ) {
    await sendToConnection({
      client,
      connectionId,
      data: singlePayload,
    });
    return;
  }

  console.log(
    `[WS Handler] Sync payload exceeded ${MAX_WS_MESSAGE_BYTES} bytes. Using chunked sync delivery.`,
    {
      connectionId,
      documentVersion: version,
      snapshotBytes: snapshot ? snapshot.length : 0,
      opCount: opStrings.length,
    }
  );

  // Chunk snapshot (if any)
  const SNAPSHOT_CHUNK_LEN = 20 * 1024; // 20KB per chunk to leave headroom for JSON overhead
  let snapshotChunkCount = 0;
  if (snapshotBase64) {
    snapshotChunkCount = Math.ceil(
      snapshotBase64.length / SNAPSHOT_CHUNK_LEN
    );
    for (let index = 0; index < snapshotChunkCount; index += 1) {
      const sliceStart = index * SNAPSHOT_CHUNK_LEN;
      const chunkData = snapshotBase64.slice(
        sliceStart,
        sliceStart + SNAPSHOT_CHUNK_LEN
      );
      await sendToConnection({
        client,
        connectionId,
        data: {
          type: "sync_snapshot_chunk",
          chunkIndex: index,
          chunkCount: snapshotChunkCount,
          data: chunkData,
        },
      });
    }
  }

  // Stream operations while respecting message size limits
  const OP_FRAGMENT_LEN = 20 * 1024;
  let currentOpsChunk: string[] = [];
  let opsSent = 0;

  const flushOpsChunk = async () => {
    if (currentOpsChunk.length === 0) {
      return;
    }
    const startIndex = opsSent;
    await sendToConnection({
      client,
      connectionId,
      data: {
        type: "sync_ops_chunk",
        startIndex,
        ops: currentOpsChunk,
      },
    });
    opsSent += currentOpsChunk.length;
    currentOpsChunk = [];
  };

  for (let index = 0; index < opStrings.length; index += 1) {
    const opStr = opStrings[index];
    const tentativeOps = [...currentOpsChunk, opStr];

    const tentativeSize = Buffer.byteLength(
      JSON.stringify({ type: "sync_ops_chunk", ops: tentativeOps }),
      "utf8"
    );

    if (tentativeSize <= MAX_WS_MESSAGE_BYTES) {
      currentOpsChunk.push(opStr);
      continue;
    }

    await flushOpsChunk();

    const singleSize = Buffer.byteLength(
      JSON.stringify({ type: "sync_ops_chunk", ops: [opStr] }),
      "utf8"
    );

    if (singleSize <= MAX_WS_MESSAGE_BYTES) {
      currentOpsChunk.push(opStr);
      continue;
    }

    // Operation itself is too large; split into fragments
    const fragmentCount = Math.ceil(opStr.length / OP_FRAGMENT_LEN);
    for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
      const fragment = opStr.slice(
        fragmentIndex * OP_FRAGMENT_LEN,
        fragmentIndex * OP_FRAGMENT_LEN + OP_FRAGMENT_LEN
      );
      await sendToConnection({
        client,
        connectionId,
        data: {
          type: "sync_op_fragment",
          startIndex: index,
          opIndex: index,
          fragmentIndex,
          fragmentCount,
          data: fragment,
        },
      });
    }
    opsSent += 1;
  }

  await flushOpsChunk();

  await sendToConnection({
    client,
    connectionId,
    data: {
      type: "sync_complete",
      version,
      snapshotChunkCount,
      opCount: opStrings.length,
      opsSent,
    },
  });
}

async function broadcastToRoom(
  documentId: string,
  message: any,
  excludeConnectionId?: string,
  connectionList?: ConnectionRecord[]
): Promise<void> {
  try {
    console.log(
      `[WS Handler] broadcastToRoom called: documentId=${documentId}, messageType=${message.type}, excludeConnectionId=${excludeConnectionId}`
    );
    let targets: ConnectionRecord[];
    
    if (connectionList) {
      targets = connectionList;
    } else {
    // Always use fallback approach for better reliability with GSI eventual consistency
    // First, try GSI query
    const gsiTargets = await getConnectionsByDocument(documentId).catch((error) => {
      console.error("Failed to fetch document connections via GSI:", error);
      return [];
    });
    
    console.log(
      `[WS Handler] GSI query found ${gsiTargets.length} connection(s) for document ${documentId}`
    );
    
    // Always also query by userId for all document collaborators as a fallback
    // This works even if GSI hasn't updated yet
    try {
      // Get document owner and collaborators to find their connections
      const { getDocumentCollaborators, query } = await import("../db/pg");
      
      // Get owner
      const docResult = await query(
        `SELECT owner_id FROM documents WHERE id = $1`,
        [documentId]
      );
      const ownerId = docResult.rows[0]?.owner_id;
      
      // Get collaborators
      const collaborators = await getDocumentCollaborators(documentId);
      const userIds = new Set<string>();
      if (ownerId) userIds.add(ownerId);
      collaborators.forEach(c => userIds.add(c.userId));
      
      console.log(
        `[WS Handler] Found ${userIds.size} user(s) with access to document ${documentId} (owner + collaborators)`
      );
      
      // Get connections for all users (owner + collaborators)
      const allUserConnections: ConnectionRecord[] = [];
      for (const userId of userIds) {
        const userConns = await getConnectionsByUser(userId);
        allUserConnections.push(...userConns);
        console.log(
          `[WS Handler] User ${userId} has ${userConns.length} active connection(s)`
        );
      }
      
      // Filter to only connections for this document
      const docConns = allUserConnections.filter(
        conn => conn.documentId === documentId
      );
      
      console.log(
        `[WS Handler] Fallback query found ${docConns.length} connection(s) for document ${documentId}`
      );
      
      // Merge GSI results with fallback results, avoiding duplicates
      const existingIds = new Set(gsiTargets.map(t => t.connectionId));
      targets = [...gsiTargets];
      for (const conn of docConns) {
        if (!existingIds.has(conn.connectionId)) {
          targets.push(conn);
          console.log(
            `[WS Handler] Added connection ${conn.connectionId} from fallback query (not found in GSI)`
          );
        }
      }
      
      console.log(
        `[WS Handler] Total connections found for document ${documentId}: ${targets.length} (${gsiTargets.length} from GSI + ${docConns.length - gsiTargets.length} from fallback)`
      );
    } catch (error) {
      // Fallback failed - use GSI results only
      console.warn("Fallback connection query failed:", error);
      targets = gsiTargets;
    }
    }

    const filteredTargets = targets.filter(
      (conn) => conn.connectionId !== excludeConnectionId
    );

    if (filteredTargets.length === 0) {
      console.warn(
        `[WS Handler] No connections to broadcast to for document ${documentId} (found ${targets.length} total, excluded ${excludeConnectionId})`
      );
      return;
    }

    console.log(
      `[WS Handler] Broadcasting ${message.type} to ${filteredTargets.length} connection(s) for document ${documentId}`,
      `Targets: ${filteredTargets.map(c => `${c.connectionId} (user: ${c.userId})`).join(', ')}`
    );

    const promises = filteredTargets.map((conn) => {
          console.log(
            `[WS Handler] Sending ${message.type} to connection ${conn.connectionId} (user: ${conn.userId})`,
            {
              messageType: message.type,
              messageSize: JSON.stringify(message).length,
              connectionId: conn.connectionId,
              userId: conn.userId
            }
          );
          return sendToConnection({
            connectionId: conn.connectionId,
            endpoint: conn.endpoint,
            data: message,
          }).then(() => {
            console.log(
              `[WS Handler] Successfully sent ${message.type} to connection ${conn.connectionId}`
            );
          }).catch((error) => {
            // Don't log errors for stale connections - they're expected
            // Only log if it's not a "gone" error
            if (!isGoneError(error)) {
              const isTimeout = error instanceof Error && 
                (error.message.includes("timeout") || error.message.includes("ETIMEDOUT"));
              if (!isTimeout) {
                console.warn(
                  `[WS Handler] Failed to send ${message.type} to connection ${conn.connectionId}:`,
                  error instanceof Error ? error.message : String(error)
                );
              } else {
                console.warn(
                  `[WS Handler] Timeout sending ${message.type} to connection ${conn.connectionId}`
                );
              }
            } else {
              console.log(
                `[WS Handler] Connection ${conn.connectionId} is gone (410), will be cleaned up`
              );
            }
          });
        });

    await Promise.allSettled(promises);
    console.log(
      `[WS Handler] broadcastToRoom completed: documentId=${documentId}, messageType=${message.type}, sent to ${filteredTargets.length} connection(s)`
    );
  } catch (error) {
    console.error(
      `[WS Handler] Error in broadcastToRoom for document ${documentId}:`,
      error
    );
    throw error; // Re-throw to let caller handle
  }
}

async function getPresenceUserMetadata(userId: string): Promise<{
  userName: string;
  email?: string;
}> {
  try {
    const userInfo = await getUserInfo(userId);
    if (userInfo) {
      return {
        userName:
          userInfo.name || userInfo.email?.split("@")[0] || "Collaborator",
        email: userInfo.email,
      };
    }
  } catch (error) {
    console.warn(
      `Failed to load user info for presence (userId=${userId}):`,
      error instanceof Error ? error.message : String(error)
    );
  }

  return { userName: "Collaborator" };
}

function isGoneError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "GoneException" || error.message.includes("410");
}

async function ensureHeartbeat(): Promise<void> {
  const now = Date.now();
  if (now - lastHeartbeatRun < HEARTBEAT_INTERVAL_MS) {
    return;
  }

  lastHeartbeatRun = now;

  try {
    const records = await listAllConnections();
    for (const record of records) {
      await handleHeartbeatForConnection(record, now);
    }
  } catch (error) {
    console.error("Heartbeat run failed:", error);
  }
}

async function handleHeartbeatForConnection(
  record: ConnectionRecord,
  now: number
): Promise<void> {
  const pendingSince = pendingPings.get(record.connectionId);
  if (pendingSince && now - pendingSince > HEARTBEAT_TIMEOUT_MS) {
    const missed = (missedPings.get(record.connectionId) || 0) + 1;
    missedPings.set(record.connectionId, missed);

    if (missed >= MAX_MISSED_PINGS) {
      await closeConnection(record);
      pendingPings.delete(record.connectionId);
      missedPings.delete(record.connectionId);
      return;
    }
  }

  if (!record.endpoint) {
    console.warn(
      `[WS Handler] Connection ${record.connectionId} missing endpoint. Removing stale connection.`
    );
    await deleteConnection(record.connectionId).catch((error) => {
      console.error(
        `[WS Handler] Failed to delete connection ${record.connectionId} with missing endpoint:`,
        error
      );
    });
    return;
  }

  if (now - record.lastActivityAt >= HEARTBEAT_INTERVAL_MS) {
    await sendToConnection({
      connectionId: record.connectionId,
      endpoint: record.endpoint,
      data: { type: "ping" },
    });
    pendingPings.set(record.connectionId, now);
  }
}

async function closeConnection(record: ConnectionRecord): Promise<void> {
  try {
    const client = getApiGatewayClient(record.endpoint);
    await client.send(
      new DeleteConnectionCommand({
        ConnectionId: record.connectionId,
      })
    );
  } catch (error) {
    if (!isGoneError(error)) {
      console.error(
        `Failed to close connection ${record.connectionId}:`,
        error
      );
    }
  } finally {
    await deleteConnection(record.connectionId);
  }
}

function checkRateLimit(connectionId: string, action: string): boolean {
  const limitConfig =
    RATE_LIMITS[action as keyof typeof RATE_LIMITS] || RATE_LIMITS.update;
  const key = `${connectionId}:${action}`;

  const limiter = rateLimiters.get(key) || {
    tokens: limitConfig.limit,
    lastRefill: Date.now(),
    limit: limitConfig.limit,
    refillMs: limitConfig.refillMs,
  };

  const now = Date.now();
  const elapsed = now - limiter.lastRefill;
  if (elapsed >= limiter.refillMs) {
    const refillCount = Math.floor(elapsed / limiter.refillMs);
    limiter.tokens = Math.min(
      limiter.limit,
      limiter.tokens + refillCount * limiter.limit
    );
    limiter.lastRefill = now;
  }

  if (limiter.tokens > 0) {
    limiter.tokens -= 1;
    rateLimiters.set(key, limiter);
    return true;
  }

  rateLimiters.set(key, limiter);
  return false;
}

async function sendErrorResponse(
  connectionId: string,
  message: string,
  code: string,
  client: ApiGatewayManagementApiClient
) {
  await sendToConnection({
    client,
    connectionId,
    data: {
      type: "error",
      code,
      message,
    },
  });
}

/**
 * WebSocket handler for API Gateway WebSocket API
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
  event: APIGatewayProxyWebsocketEventV2,
  context: Context
) => {
  const routeKey = event.requestContext.routeKey;
  const connectionId = event.requestContext.connectionId!;
  const endpoint = getEndpointFromEvent(event);
  
  console.log(`[WS Handler] Received event: ${routeKey}, connectionId: ${connectionId}, endpoint: ${endpoint}`);
  console.log(`[WS Handler] Event details:`, JSON.stringify({
    routeKey,
    connectionId,
    domainName: event.requestContext.domainName,
    stage: event.requestContext.stage,
    requestId: context.awsRequestId,
  }));

  context.callbackWaitsForEmptyEventLoop = false;
  
  // Create API Gateway client (needed for most routes except $connect)
  // For $connect, we create it but don't use it (we just return status codes)
  const apiGatewayClient = getApiGatewayClient(endpoint);

  // Don't run heartbeat during $connect - it can cause delays
  // Heartbeat will run on subsequent messages
  const scheduleHeartbeat = () =>
    ensureHeartbeat().catch((error) => {
      console.error("[WS Handler] Heartbeat failed (non-blocking):", error);
    });

  if (routeKey !== "$connect") {
    scheduleHeartbeat();
  } else {
    scheduleHeartbeat();
  }

  console.log(`[WS Handler] WebSocket event: ${routeKey}, connectionId: ${connectionId}`);

  // Handle $connect route
  if (routeKey === "$connect") {
    const queryParams = (event as any).queryStringParameters as
      | Record<string, string>
      | undefined;
    const headers = (event as any).headers as
      | Record<string, string>
      | undefined;
    const token =
      queryParams?.token ||
      headers?.["Authorization"]?.replace("Bearer ", "") ||
      headers?.["authorization"]?.replace("Bearer ", "") ||
      null;

    let user;
    try {
      user = await verifyJWT(token || null);
      if (!user) {
        return { statusCode: 401 };
      }
    } catch (error) {
      console.error(`[WS Handler] JWT verification error:`, error);
      return { statusCode: 401 };
    }

    // Return immediately to accept connection - API Gateway has strict timeout (~500ms)
    // Do all heavy work asynchronously after returning
    const now = Date.now();
    
    // Save connection with timeout - this is critical for $default handler
    // Use Promise.race to ensure we don't block too long (API Gateway timeout is ~500ms)
    const saveConnectionPromise = saveConnection({
      connectionId,
      userId: user.userId,
      documentId: null,
      connectedAt: now,
      lastActivityAt: now,
      endpoint,
    }).catch((error) => {
      console.error(
        `[WS Handler] Failed to save connection ${connectionId} (non-critical, will retry):`,
        error instanceof Error ? error.message : String(error)
      );
      // Don't fail the connection - we'll retry on first message
    });

    // Race against a timeout - if save takes too long, return anyway
    // The save will continue in the background
    try {
      await Promise.race([
        saveConnectionPromise,
        new Promise<void>((resolve) =>
          setTimeout(() => {
            console.warn(
              `[WS Handler] Connection save timed out for ${connectionId}, continuing anyway (save will complete in background)`
            );
            resolve();
          }, 200)
        ),
      ]);
    } catch (error) {
      // Ignore - save will continue in background
      console.warn(
        `[WS Handler] Connection save error (non-critical):`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Do connection limit check and cleanup asynchronously (non-blocking)
    (async () => {
      try {
        let userConnections = await getUserConnectionCount(user.userId).catch(() => 0);
        
        if (userConnections >= USER_CONNECTION_LIMIT) {
          try {
            await cleanupStaleUserConnections(user.userId);
          } catch (error) {
            console.warn(
              `[WS Handler] Error during async stale connection cleanup:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      } catch (error) {
        // Ignore - this is best-effort cleanup
        console.warn(
          `[WS Handler] Async connection limit check failed:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    })();

    pendingPings.delete(connectionId);
    missedPings.delete(connectionId);

    // Return immediately - connection is accepted
    return { statusCode: 200 };
  }

  // Handle $disconnect route
  if (routeKey === "$disconnect") {
    // Delete connection from DynamoDB immediately (non-blocking)
    // Don't wait for presence broadcasts - they can timeout
    const conn = await getConnection(connectionId);
    
    // Delete connection first to ensure cleanup happens even if broadcast fails
    await deleteConnection(connectionId).catch((error) => {
      console.error(`[WS Handler] Error deleting connection ${connectionId}:`, error);
    });

    pendingPings.delete(connectionId);
    missedPings.delete(connectionId);

    // Broadcast presence update asynchronously (non-blocking)
    if (conn && conn.documentId) {
      // Run broadcast in background - don't wait for it
      (async () => {
        try {
          const remainingConnections = await getConnectionsByDocument(
            conn.documentId!
          );
          const userStillPresent = remainingConnections.some(
            (record) =>
              record.connectionId !== connectionId &&
              record.userId === conn.userId
          );

          if (!userStillPresent) {
            const presenceMeta = await getPresenceUserMetadata(conn.userId);
            await broadcastToRoom(
              conn.documentId!,
              {
        type: "presence",
        action: "leave",
        userId: conn.userId,
                userName: presenceMeta.userName,
                email: presenceMeta.email,
                timestamp: Date.now(),
              },
              connectionId,
              remainingConnections
            );
    }
        } catch (error) {
          // Log but don't fail - connection is already deleted
          console.error(`[WS Handler] Error broadcasting presence on disconnect:`, error);
        }
      })();
    }

    console.log(`[WS Handler] Connection ${connectionId} disconnected`);
    // Return immediately - don't wait for broadcasts
    return { statusCode: 200 };
  }

  // Handle $default route (all other messages)
  if (routeKey === "$default") {
    let conn = await getConnection(connectionId);
    
    // If connection doesn't exist yet (save might have timed out during $connect),
    // try to get user info from the message or wait a bit for eventual consistency
    if (!conn) {
      // Wait a short time for eventual consistency (connection might be saved but not yet visible)
      await new Promise((resolve) => setTimeout(resolve, 100));
      conn = await getConnection(connectionId);
      
      if (!conn) {
        console.warn(
          `[WS Handler] Connection ${connectionId} not found in DynamoDB. This may indicate the $connect save timed out.`
        );
        return { statusCode: 401 };
      }
    }

    try {
      const sizeValidation = validateRawMessageSize(event.body || null);
      if (!sizeValidation.valid) {
        await sendErrorResponse(
          connectionId,
          sizeValidation.message || "Invalid message",
          sizeValidation.code || "INVALID_PAYLOAD",
          apiGatewayClient
        );
        return { statusCode: 400 };
      }

      const message = JSON.parse(event.body || "{}");
      const validation = validateMessage(message);
      if (!validation.valid) {
        await sendErrorResponse(
          connectionId,
          validation.message || "Invalid message",
          validation.code || "INVALID_PAYLOAD",
          apiGatewayClient
        );
        return { statusCode: 400 };
      }

      const { action, documentId, update, lastKnownVersion } = message;

      if (!checkRateLimit(connectionId, action)) {
        await sendErrorResponse(
          connectionId,
          "Rate limit exceeded. Please slow down.",
          "RATE_LIMIT_EXCEEDED",
          apiGatewayClient
        );
        return { statusCode: 429 };
      }

      if (action === "join" && documentId) {
        // Clean up any orphaned connections for this user (connections without a document)
        // This helps prevent connection accumulation when users reconnect
        try {
          const userConnections = await getConnectionsByUser(conn.userId);
          const now = Date.now();
          const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
          
          for (const userConn of userConnections) {
            // Clean up orphaned connections (no documentId) that are older than 2 minutes
            if (!userConn.documentId && userConn.connectionId !== connectionId) {
              if (now - userConn.lastActivityAt > STALE_THRESHOLD_MS) {
                console.log(`[WS Handler] Cleaning up orphaned connection ${userConn.connectionId} for user ${conn.userId}`);
                await deleteConnection(userConn.connectionId).catch((error) => {
                  console.error(`[WS Handler] Error cleaning up orphaned connection:`, error);
                });
              }
            }
          }
        } catch (error) {
          // Log but don't fail - cleanup is best effort
          console.error(`[WS Handler] Error during connection cleanup on join:`, error);
        }

        const docConnections = await getDocumentConnectionCount(documentId);
        if (docConnections >= DOCUMENT_CONNECTION_LIMIT) {
          await sendErrorResponse(
            connectionId,
            "Maximum document connections reached",
            "CONNECTION_LIMIT_EXCEEDED",
            apiGatewayClient
          );
          return { statusCode: 403 };
        }

        const syncData = await joinRoom(
          documentId,
          conn.userId,
          typeof lastKnownVersion === "number" ? lastKnownVersion : null
        );

        if (!syncData) {
          await sendErrorResponse(
            connectionId,
            "Access denied to document",
            "ACCESS_DENIED",
            apiGatewayClient
          );
          return { statusCode: 403 };
        }

        // Set documentId in DynamoDB (non-blocking - GSI will update eventually)
        await setConnectionDocument(connectionId, documentId);
        // Update in-memory cache
        conn.documentId = documentId;

        console.log(
          `[WS Handler] Connection ${connectionId} joined document ${documentId}`
        );

        await sendChunkedSyncPayload({
          client: apiGatewayClient,
          connectionId,
          snapshot: syncData.snapshot,
          ops: syncData.ops,
          version: syncData.version,
        });

        const presenceMeta = await getPresenceUserMetadata(conn.userId);

        await broadcastToRoom(
          documentId,
          {
          type: "presence",
          action: "join",
          userId: conn.userId,
            userName: presenceMeta.userName,
            email: presenceMeta.email,
            timestamp: Date.now(),
          },
          connectionId
        );

        await updateConnectionActivity(connectionId);
        return { statusCode: 200 };
      }

      if (action === "update" && documentId && update) {
        // Validate documentId is a valid UUID (safety check even though validation should catch this)
        if (
          typeof documentId !== "string" ||
          documentId.trim() === "" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)
        ) {
          console.error(
            `[WS Handler] Invalid documentId in update action: "${documentId}" (type: ${typeof documentId})`
          );
          await sendErrorResponse(
            connectionId,
            "Invalid document ID format",
            "INVALID_DOCUMENT_ID",
            apiGatewayClient
          );
          return { statusCode: 400 };
        }
        
        // Check user's role - viewers cannot send updates
        const access = await checkDocumentAccess(documentId, conn.userId);
        if (access === "viewer") {
          await sendErrorResponse(
            connectionId,
            "Read-only access. Viewers cannot edit documents.",
            "READ_ONLY_ACCESS",
            apiGatewayClient
          );
          return { statusCode: 403 };
        }

        // Only owner and editor can proceed
        if (!access || access === null) {
          await sendErrorResponse(
            connectionId,
            "Access denied to document",
            "ACCESS_DENIED",
            apiGatewayClient
          );
          return { statusCode: 403 };
        }

        const updateBuffer = Buffer.from(update, "base64");
        console.log(
          `[WS Handler] Received update from user ${conn.userId} for document ${documentId}, size: ${updateBuffer.length} bytes`
        );
        
        // Verify connection has documentId set
        if (!conn.documentId || conn.documentId !== documentId) {
          console.error(
            `[WS Handler] Connection ${connectionId} documentId mismatch. Expected: ${documentId}, Got: ${conn.documentId}. Refreshing connection...`
          );
          let refreshedConn = await getConnection(connectionId);

          if (!refreshedConn || refreshedConn.documentId !== documentId) {
            // Attempt to repair the connection metadata by setting the documentId explicitly
            if (!refreshedConn?.documentId) {
              console.warn(
                `[WS Handler] Connection ${connectionId} missing documentId in DynamoDB. Attempting to set documentId=${documentId}.`
              );
              try {
                await setConnectionDocument(connectionId, documentId);
                refreshedConn = await getConnection(connectionId);
              } catch (error) {
                console.error(
                  `[WS Handler] Failed to repair connection ${connectionId} documentId:`,
                  error
                );
              }
            }

            if (!refreshedConn || refreshedConn.documentId !== documentId) {
              await sendErrorResponse(
                connectionId,
                "Not joined to this document. Please rejoin the document.",
                "INVALID_DOCUMENT",
                apiGatewayClient
              );
              return { statusCode: 400 };
            }
          }

          conn.documentId = refreshedConn.documentId;
        }
        
        const shouldSnapshot = await saveOperation(
          documentId,
          updateBuffer,
          connectionId
        );

        // Get all connections for this document and broadcast
        // Note: GSI eventual consistency means we might not find all connections immediately,
        // but this is acceptable - subsequent updates will be broadcast correctly
        // Broadcast to all other connections in the room
        const updateMessage = {
          type: "update",
          documentId,
          update: update,
        };
        console.log(
          `[WS Handler] Broadcasting update message:`,
          {
            documentId,
            updateSize: update.length,
            messageSize: JSON.stringify(updateMessage).length,
            excludeConnectionId: connectionId
          }
        );
        try {
          await broadcastToRoom(
            documentId,
            updateMessage,
            connectionId
          );
          console.log(
            `[WS Handler] Update broadcast completed for document ${documentId}`
          );
        } catch (error) {
          console.error(
            `[WS Handler] Error broadcasting update for document ${documentId}:`,
            error
          );
          // Don't fail the request - the update was saved, just broadcast failed
        }

        // Only request snapshots if the document isn't too large
        // Large documents will rely on incremental updates only
        if (shouldSnapshot) {
          // Check document size - if it's too large, skip snapshot requests
          // We'll rely on incremental updates instead
          const docSize = updateBuffer.length; // Rough estimate from update size
          // If updates are small (normal typing), allow snapshots
          // If updates are large, the document is probably too big for snapshots
          if (docSize < 10000) { // Only request snapshots for reasonably sized documents
            await broadcastToRoom(documentId, {
            type: "snapshot_needed",
            documentId,
          });
          } else {
            console.log(
              `[WS Handler] Skipping snapshot request for document ${documentId} - document appears too large`
            );
          }
        }

        await updateConnectionActivity(connectionId);
        return { statusCode: 200 };
      }

      if (action === "presence" && documentId) {
        if (conn.documentId !== documentId) {
          return { statusCode: 400 };
        }

        await broadcastToRoom(
          documentId,
          {
          type: "presence",
          userId: conn.userId,
          cursor: message.cursor,
          selection: message.selection,
          },
          connectionId
        );

        await updateConnectionActivity(connectionId);
        return { statusCode: 200 };
      }

      if (action === "create_snapshot" && documentId && update) {
        if (conn.documentId !== documentId) {
          return { statusCode: 400 };
        }

        // Check user's role - viewers cannot create snapshots
        const access = await checkDocumentAccess(documentId, conn.userId);
        if (access === "viewer" || !access || access === null) {
          await sendErrorResponse(
            connectionId,
            "Read-only access. Viewers cannot create snapshots.",
            "READ_ONLY_ACCESS",
            apiGatewayClient
          );
          return { statusCode: 403 };
        }

        const snapshotBuffer = Buffer.from(update, "base64");
        try {
        const version = await createSnapshot(documentId, snapshotBuffer);

          await broadcastToRoom(documentId, {
          type: "snapshot_created",
          documentId,
          version,
        });

          await updateConnectionActivity(connectionId);
          return { statusCode: 200 };
        } catch (error: any) {
          // Handle duplicate snapshot gracefully - it's fine if another client already created it
          if (error.code === "23505" || error.message?.includes("duplicate key")) {
            console.log(
              `[WS Handler] Snapshot already exists for document ${documentId}, ignoring duplicate`
            );
            await updateConnectionActivity(connectionId);
            return { statusCode: 200 };
          }
          throw error;
        }
      }

      if (action === "ping") {
        await sendToConnection({
          client: apiGatewayClient,
          connectionId,
          data: { type: "pong" },
        });
        await updateConnectionActivity(connectionId);
        return { statusCode: 200 };
      }

      if (action === "pong") {
        pendingPings.delete(connectionId);
        missedPings.delete(connectionId);
        await updateConnectionActivity(connectionId);
        return { statusCode: 200 };
      }

      console.log(`Unknown action: ${action}`);
      return { statusCode: 400 };
    } catch (error) {
      console.error(`Error handling message:`, error);
      await sendErrorResponse(
        connectionId,
        error instanceof Error ? error.message : "Internal error",
        "INTERNAL_ERROR",
        apiGatewayClient
      );
      return { statusCode: 500 };
    }
  }

  return { statusCode: 200 };
};
