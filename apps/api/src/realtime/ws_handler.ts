import {
  APIGatewayProxyWebsocketHandlerV2,
  APIGatewayProxyWebsocketEventV2,
} from "aws-lambda";
import jwt from "jsonwebtoken";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  DeleteConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { joinRoom, saveOperation, createSnapshot } from "./persist";

// In-memory connection tracking (per Lambda instance)
// In production, use DynamoDB or ElastiCache for multi-instance support
interface Connection {
  userId: string;
  documentId: string | null;
  connectedAt: number;
}

const connections = new Map<string, Connection>();

// JWT secret cache (same pattern as auth.ts)
let jwtSecret: string | null = null;
let secretInitPromise: Promise<string> | null = null;

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

/**
 * Get API Gateway Management API client
 */
function getApiGatewayClient(event: APIGatewayProxyWebsocketEventV2) {
  const endpoint = `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
  return new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.REGION || "us-east-1",
  });
}

/**
 * Send message to a WebSocket connection
 */
async function sendToConnection(
  client: ApiGatewayManagementApiClient,
  connectionId: string,
  data: any
): Promise<void> {
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    });
    await client.send(command);
  } catch (error) {
    // Connection may have been closed
    if (
      error instanceof Error &&
      (error.name === "GoneException" || error.message.includes("410"))
    ) {
      console.log(`Connection ${connectionId} is gone, removing from map`);
      connections.delete(connectionId);
    } else {
      console.error(`Failed to send to connection ${connectionId}:`, error);
    }
  }
}

/**
 * Broadcast message to all connections in a document room
 */
async function broadcastToRoom(
  client: ApiGatewayManagementApiClient,
  documentId: string,
  message: any,
  excludeConnectionId?: string
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [connectionId, conn] of connections.entries()) {
    if (
      conn.documentId === documentId &&
      connectionId !== excludeConnectionId
    ) {
      promises.push(sendToConnection(client, connectionId, message));
    }
  }

  await Promise.allSettled(promises);
}

/**
 * WebSocket handler for API Gateway WebSocket API
 */
export const handler: APIGatewayProxyWebsocketHandlerV2 = async (
  event: APIGatewayProxyWebsocketEventV2
) => {
  const routeKey = event.requestContext.routeKey;
  const connectionId = event.requestContext.connectionId;
  const apiGatewayClient = getApiGatewayClient(event);

  console.log(`WebSocket event: ${routeKey}, connectionId: ${connectionId}`);

  // Handle $connect route
  if (routeKey === "$connect") {
    // For $connect, query params are available in requestContext
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

    const user = await verifyJWT(token);
    if (!user) {
      console.log(`Connection ${connectionId} rejected: invalid JWT`);
      return { statusCode: 401 };
    }

    // Store connection mapping
    connections.set(connectionId, {
      userId: user.userId,
      documentId: null,
      connectedAt: Date.now(),
    });

    console.log(
      `Connection ${connectionId} established for user ${user.userId}`
    );
    return { statusCode: 200 };
  }

  // Handle $disconnect route
  if (routeKey === "$disconnect") {
    const conn = connections.get(connectionId);
    if (conn && conn.documentId) {
      // Notify other users in the room
      await broadcastToRoom(apiGatewayClient, conn.documentId, {
        type: "presence",
        action: "leave",
        userId: conn.userId,
      });
    }
    connections.delete(connectionId);
    console.log(`Connection ${connectionId} disconnected`);
    return { statusCode: 200 };
  }

  // Handle $default route (all other messages)
  if (routeKey === "$default") {
    const conn = connections.get(connectionId);
    if (!conn) {
      console.log(`Connection ${connectionId} not found`);
      return { statusCode: 401 };
    }

    try {
      const message = JSON.parse(event.body || "{}");
      const { action, documentId, update, lastKnownVersion } = message;

      // Handle join action
      if (action === "join" && documentId) {
        const syncData = await joinRoom(documentId, conn.userId);

        if (!syncData) {
          await sendToConnection(apiGatewayClient, connectionId, {
            type: "error",
            message: "Access denied to document",
          });
          return { statusCode: 403 };
        }

        // Update connection document mapping
        conn.documentId = documentId;

        // Send sync payload
        await sendToConnection(apiGatewayClient, connectionId, {
          type: "sync",
          snapshot: syncData.snapshot
            ? syncData.snapshot.toString("base64")
            : null,
          ops: syncData.ops.map((op) => op.toString("base64")),
          version: syncData.version,
        });

        // Notify other users in the room
        await broadcastToRoom(apiGatewayClient, documentId, {
          type: "presence",
          action: "join",
          userId: conn.userId,
        });

        console.log(
          `User ${conn.userId} joined document ${documentId} (connection ${connectionId})`
        );
        return { statusCode: 200 };
      }

      // Handle update action (Y.js update)
      if (action === "update" && documentId && update) {
        if (conn.documentId !== documentId) {
          await sendToConnection(apiGatewayClient, connectionId, {
            type: "error",
            message: "Not joined to this document",
          });
          return { statusCode: 400 };
        }

        // Decode base64 update
        const updateBuffer = Buffer.from(update, "base64");

        // Save operation
        const shouldSnapshot = await saveOperation(
          documentId,
          updateBuffer,
          connectionId
        );

        // Broadcast to all other connections in the room
        await broadcastToRoom(apiGatewayClient, documentId, {
          type: "update",
          update,
          userId: conn.userId,
        });

        // If snapshot needed, notify clients (they can request snapshot)
        if (shouldSnapshot) {
          await broadcastToRoom(apiGatewayClient, documentId, {
            type: "snapshot_needed",
            documentId,
          });
        }

        return { statusCode: 200 };
      }

      // Handle presence action (cursor position, etc.)
      if (action === "presence" && documentId) {
        if (conn.documentId !== documentId) {
          return { statusCode: 400 };
        }

        // Broadcast presence to other users
        await broadcastToRoom(apiGatewayClient, documentId, {
          type: "presence",
          userId: conn.userId,
          cursor: message.cursor,
          selection: message.selection,
        });

        return { statusCode: 200 };
      }

      // Handle snapshot creation request
      if (action === "create_snapshot" && documentId && update) {
        if (conn.documentId !== documentId) {
          return { statusCode: 400 };
        }

        const snapshotBuffer = Buffer.from(update, "base64");
        const version = await createSnapshot(documentId, snapshotBuffer);

        // Notify all clients about new snapshot
        await broadcastToRoom(apiGatewayClient, documentId, {
          type: "snapshot_created",
          documentId,
          version,
        });

        return { statusCode: 200 };
      }

      console.log(`Unknown action: ${action}`);
      return { statusCode: 400 };
    } catch (error) {
      console.error(`Error handling message:`, error);
      await sendToConnection(apiGatewayClient, connectionId, {
        type: "error",
        message: error instanceof Error ? error.message : "Internal error",
      });
      return { statusCode: 500 };
    }
  }

  return { statusCode: 200 };
};
