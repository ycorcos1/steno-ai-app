import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  getConnectionsByDocument,
  getConnectionsByUser,
  ConnectionRecord,
  deleteConnection,
} from "./connections";

const apiGatewayClientCache = new Map<string, ApiGatewayManagementApiClient>();

function getApiGatewayClient(endpoint: string): ApiGatewayManagementApiClient {
  if (apiGatewayClientCache.has(endpoint)) {
    return apiGatewayClientCache.get(endpoint)!;
  }

  const client = new ApiGatewayManagementApiClient({
    endpoint,
    region: process.env.REGION || "us-east-1",
    requestHandler: {
      requestTimeout: 5000,
    },
  });
  apiGatewayClientCache.set(endpoint, client);
  return client;
}

function isGoneError(error: any): boolean {
  return (
    error?.$metadata?.httpStatusCode === 410 ||
    error?.statusCode === 410 ||
    error?.code === "GoneException"
  );
}

async function sendToConnection(
  connectionId: string,
  endpoint: string,
  data: any
): Promise<void> {
  const client = getApiGatewayClient(endpoint);
  try {
    const command = new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(data),
    });
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
      const isTimeout =
        error instanceof Error &&
        (error.message.includes("timeout") ||
          error.message.includes("ETIMEDOUT"));
      if (!isTimeout) {
        console.warn(
          `[Broadcast] Failed to send to connection ${connectionId}:`,
          error instanceof Error ? error.message : String(error)
        );
      } else {
        // Silently delete stale connections that timeout
        await deleteConnection(connectionId).catch(() => {
          // Ignore errors when deleting
        });
      }
    }
    throw error;
  }
}

/**
 * Broadcast a message to all WebSocket connections for a document
 * Can be called from REST API routes
 */
export async function broadcastToDocument(
  documentId: string,
  message: any
): Promise<void> {
  try {
    console.log(
      `[Broadcast] Broadcasting ${message.type} to document ${documentId}`
    );

    // Get connections for this document using GSI
    const gsiTargets = await getConnectionsByDocument(documentId).catch(
      (error) => {
        console.error("Failed to fetch document connections via GSI:", error);
        return [];
      }
    );

    // Fallback: query by userId for document collaborators (handles eventual consistency)
    let targets: ConnectionRecord[] = gsiTargets;
    try {
      const { getDocumentCollaborators, query } = await import("../db/pg");

      const docResult = await query(
        `SELECT owner_id FROM documents WHERE id = $1`,
        [documentId]
      );
      const ownerId = docResult.rows[0]?.owner_id;

      const collaborators = await getDocumentCollaborators(documentId);
      const userIds = new Set<string>();
      if (ownerId) userIds.add(ownerId);
      collaborators.forEach((c) => userIds.add(c.userId));

      const allUserConnections: ConnectionRecord[] = [];
      for (const userId of userIds) {
        const userConns = await getConnectionsByUser(userId);
        allUserConnections.push(...userConns);
      }

      const docConns = allUserConnections.filter(
        (conn) => conn.documentId === documentId
      );

      // Merge GSI results with fallback results, avoiding duplicates
      const existingIds = new Set(gsiTargets.map((t) => t.connectionId));
      targets = [...gsiTargets];
      for (const conn of docConns) {
        if (!existingIds.has(conn.connectionId)) {
          targets.push(conn);
        }
      }
    } catch (error) {
      console.warn("Fallback connection query failed:", error);
      targets = gsiTargets;
    }

    if (targets.length === 0) {
      console.log(
        `[Broadcast] No active connections for document ${documentId}`
      );
      return;
    }

    console.log(
      `[Broadcast] Sending ${message.type} to ${targets.length} connection(s)`
    );

    const promises = targets.map((conn) =>
      sendToConnection(conn.connectionId, conn.endpoint, message).catch(
        (error) => {
          // Silently handle errors for stale connections
          if (!isGoneError(error)) {
            const isTimeout =
              error instanceof Error &&
              (error.message.includes("timeout") ||
                error.message.includes("ETIMEDOUT"));
            if (!isTimeout) {
              console.warn(
                `[Broadcast] Failed to send to connection ${conn.connectionId}:`,
                error instanceof Error ? error.message : String(error)
              );
            }
          }
        }
      )
    );

    await Promise.allSettled(promises);
    console.log(
      `[Broadcast] Completed broadcasting ${message.type} to document ${documentId}`
    );
  } catch (error) {
    console.error(
      `[Broadcast] Error broadcasting to document ${documentId}:`,
      error
    );
    // Don't throw - broadcasting failures shouldn't break the refinement
  }
}

